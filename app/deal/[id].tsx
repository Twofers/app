import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { supabase } from "../../lib/supabase";
import { claimDeal } from "../../lib/functions";
import { buildClaimDealTelemetry } from "../../lib/claim-telemetry";
import { trackAppAnalyticsEvent } from "../../lib/app-analytics";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { QrModal } from "../../components/qr-modal";
import { useBusiness } from "../../hooks/use-business";
import { formatValiditySummary } from "../../lib/deal-time";
import { translateKnownApiMessage } from "../../lib/i18n/api-messages";
import { resolveDealPosterDisplayUri } from "../../lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";

type Deal = {
  id: string;
  title: string | null;
  description: string | null;
  end_time: string;
  start_time: string;
  poster_url: string | null;
  poster_storage_path?: string | null;
  business_id: string;
  price: number | null;
  claim_cutoff_buffer_minutes: number;
  max_claims: number;
  businesses?: {
    name: string | null;
  } | null;
  is_recurring?: boolean;
  days_of_week?: number[] | null;
  window_start_minutes?: number | null;
  window_end_minutes?: number | null;
  timezone?: string | null;
};

export default function DealDetail() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { height: winH } = useWindowDimensions();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const id = typeof idParam === "string" ? idParam : idParam?.[0] ?? "";
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "failed">("loading");
  const { isLoggedIn, userId, loading: authLoading } = useBusiness();
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [claimSuccessToastNonce, setClaimSuccessToastNonce] = useState(0);
  const [isClaiming, setIsClaiming] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [claimsCount, setClaimsCount] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  const loadClaimCount = useCallback(async (dealId: string) => {
    const { count, error } = await supabase
      .from("deal_claims")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    if (!error && typeof count === "number") {
      setClaimsCount(count);
    }
  }, []);

  const loadDeal = useCallback(async () => {
    if (!id) {
      setLoadStatus("failed");
      return;
    }
    setLoadStatus("loading");
    setBanner(null);
    const { data, error } = await supabase
      .from("deals")
      .select(
        "id,title,description,end_time,start_time,poster_url,poster_storage_path,business_id,price,claim_cutoff_buffer_minutes,max_claims,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone,businesses(name)",
      )
      .eq("id", id)
      .single();
    if (error) {
      setDeal(null);
      setBanner(translateKnownApiMessage(error.message, t));
      setLoadStatus("failed");
      return;
    }
    const dealData = data as unknown as Deal;
    setDeal(dealData);
    setLoadStatus("ready");
    await loadClaimCount(dealData.id);
  }, [id, loadClaimCount, t]);

  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn) {
      router.replace("/auth-landing");
      return;
    }
    void loadDeal();
  }, [loadDeal, authLoading, isLoggedIn, router]);

  useEffect(() => {
    (async () => {
      if (!userId || !deal?.business_id) return;
      const { data: fav } = await supabase
        .from("favorites")
        .select("business_id")
        .eq("user_id", userId)
        .eq("business_id", deal.business_id)
        .maybeSingle();
      setIsFavorite(!!fav);
    })();
  }, [userId, deal?.business_id]);

  async function doClaim() {
    try {
      if (!isLoggedIn) {
        setBanner(t("dealDetail.errLoginClaim"));
        return;
      }
      if (!deal) return;
      if (isClaiming) return;
      setIsClaiming(true);
      const telem = await buildClaimDealTelemetry(isFavorite ? "favorite" : "direct");
      const out = await claimDeal(deal.id, telem);
      if (out.claim_id) {
        trackAppAnalyticsEvent({
          event_name: "deal_claimed",
          deal_id: deal.id,
          business_id: deal.business_id,
          claim_id: out.claim_id,
        });
        setClaimSuccessToastNonce((n) => n + 1);
      }
      setQrToken(out.token);
      setQrExpires(out.expires_at);
      setQrVisible(true);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : JSON.stringify(e, null, 2);
      setBanner(translateKnownApiMessage(msg, t));
    } finally {
      setIsClaiming(false);
    }
  }

  async function refreshQr() {
    if (!deal) return;
    if (refreshingQr) return;
    setRefreshingQr(true);
    try {
      const out = await claimDeal(deal.id);
      setQrToken(out.token);
      setQrExpires(out.expires_at);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : JSON.stringify(e, null, 2);
      setBanner(translateKnownApiMessage(msg, t));
    } finally {
      setRefreshingQr(false);
    }
  }

  async function toggleFavorite() {
    if (!userId || !deal?.business_id) {
      setBanner(t("dealDetail.errLoginFavorite"));
      return;
    }
    const next = !isFavorite;
    setIsFavorite(next);
    if (next) {
      const { error } = await supabase
        .from("favorites")
        .insert({ user_id: userId, business_id: deal.business_id });
      if (error) {
        setIsFavorite(!next);
        setBanner(translateKnownApiMessage(error.message, t));
      }
    } else {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("user_id", userId)
        .eq("business_id", deal.business_id);
      if (error) {
        setIsFavorite(!next);
        setBanner(translateKnownApiMessage(error.message, t));
      }
    }
  }

  if (authLoading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isLoggedIn) {
    return null;
  }

  if (loadStatus === "loading") {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("dealDetail.title")}</Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.8 }}>{t("dealDetail.loading")}</Text>
      </View>
    );
  }

  if (loadStatus === "failed" || !deal) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, gap: Spacing.lg }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("dealDetail.title")}</Text>
        {banner ? <Banner message={banner} tone="error" /> : null}
        <Text style={{ opacity: 0.78, fontSize: 16, lineHeight: 24 }}>{t("dealDetail.couldNotLoad")}</Text>
        <SecondaryButton
          title={t("commonUi.goBack")}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}
        />
      </View>
    );
  }

  const remaining = Math.max(0, deal.max_claims - claimsCount);
  const heroHeight = Math.round(Math.min(400, Math.max(248, winH * 0.4)));

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      {banner ? <Banner message={banner} tone="error" /> : null}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: scrollBottom }}
      >
        <Pressable
          onPress={toggleFavorite}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.sm,
            marginBottom: Spacing.md,
            minHeight: 44,
          }}
        >
          <MaterialIcons
            name={isFavorite ? "favorite" : "favorite-border"}
            size={22}
            color={isFavorite ? "#e0245e" : "#666"}
          />
          <Text style={{ color: "#444", fontSize: 16, fontWeight: "600" }}>
            {isFavorite ? t("dealDetail.favorited") : t("dealDetail.favorite")}
          </Text>
        </Pressable>
        {(() => {
          const posterUri = resolveDealPosterDisplayUri(deal.poster_url, deal.poster_storage_path);
          return posterUri ? (
            <Image
              source={{ uri: posterUri }}
              style={{ height: heroHeight, width: "100%", borderRadius: 18 }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                height: heroHeight,
                borderRadius: 18,
                backgroundColor: "#e8e8e8",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#666", fontSize: 15 }}>{t("dealDetail.noImage")}</Text>
            </View>
          );
        })()}

        <View style={{ marginTop: Spacing.lg, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: Spacing.sm }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              opacity: 0.55,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {deal.businesses?.name ?? t("dealDetail.localBusiness")}
          </Text>
          <SecondaryButton
            title={t("dealDetail.viewBusiness")}
            onPress={() => router.push(`/business/${deal.business_id}` as Href)}
          />
        </View>
        <Text style={{ fontSize: 24, fontWeight: "700", marginTop: Spacing.xs, lineHeight: 30 }}>
          {deal.title ?? t("dealDetail.dealFallback")}
        </Text>
        {deal.price != null ? (
          <Text style={{ marginTop: Spacing.sm, fontWeight: "700", fontSize: 20 }}>${deal.price.toFixed(2)}</Text>
        ) : null}
        {deal.description ? (
          <Text style={{ marginTop: Spacing.md, fontSize: 16, lineHeight: 24 }}>{deal.description}</Text>
        ) : null}
        <View
          style={{
            marginTop: Spacing.lg,
            borderRadius: 16,
            backgroundColor: "#f6f6f6",
            padding: Spacing.lg,
          }}
        >
          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm, fontSize: 16 }}>{t("dealDetail.finePrint")}</Text>
          <Text style={{ opacity: 0.78, fontSize: 15, lineHeight: 22 }}>
            {t("dealDetail.validityPrefix")}{" "}
            {formatValiditySummary(deal, {
              lang: i18n.language,
              endsVerb: t("commonUi.dealEndsVerb"),
              t,
            })}
          </Text>
          <Text style={{ opacity: 0.78, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
            {t("dealDetail.cutoffPrefix")} {deal.claim_cutoff_buffer_minutes} {t("dealDetail.cutoffSuffix")}
          </Text>
          <Text style={{ opacity: 0.78, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
            {t("dealDetail.claimsRemaining")} {remaining} / {deal.max_claims}
          </Text>
        </View>

        <View style={{ marginTop: Spacing.xl, gap: Spacing.md }}>
          <PrimaryButton
            title={isClaiming ? t("dealDetail.claiming") : t("dealDetail.claim")}
            onPress={doClaim}
            disabled={isClaiming}
          />
          <SecondaryButton
            title={refreshingQr ? t("dealDetail.refreshingQr") : t("dealDetail.refreshQr")}
            onPress={refreshQr}
            disabled={refreshingQr}
          />
        </View>
      </ScrollView>

      <QrModal
        visible={qrVisible}
        token={qrToken}
        expiresAt={qrExpires}
        successToastNonce={claimSuccessToastNonce}
        onHide={() => setQrVisible(false)}
        onRefresh={refreshQr}
        refreshing={refreshingQr}
      />
    </View>
  );
}
