import { useCallback, useEffect, useRef, useState } from "react";
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
import { ScreenHeader } from "../../components/ui/screen-header";
import { QrModal } from "../../components/qr-modal";
import { useBusiness } from "../../hooks/use-business";
import { useColorScheme } from "../../hooks/use-color-scheme";
import { Colors, Radii } from "../../constants/theme";
import { formatValiditySummary } from "../../lib/deal-time";
import { translateKnownApiMessage } from "../../lib/i18n/api-messages";
import { resolveDealPosterDisplayUri } from "../../lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { ReportSheet } from "@/components/report-sheet";
import { submitBusinessReport, type BusinessReportReason } from "@/lib/reports";

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
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const id = typeof idParam === "string" ? idParam : idParam?.[0] ?? "";
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "failed">("loading");
  const { isLoggedIn, userId, loading: authLoading } = useBusiness();
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrShortCode, setQrShortCode] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [claimSuccessToastNonce, setClaimSuccessToastNonce] = useState(0);
  const [isClaiming, setIsClaiming] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const openedDealIdRef = useRef<string | null>(null);
  const [claimsCount, setClaimsCount] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [reportVisible, setReportVisible] = useState(false);

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
    if (!userId || !deal?.business_id) return;
    let cancelled = false;
    (async () => {
      const { data: fav } = await supabase
        .from("favorites")
        .select("business_id")
        .eq("user_id", userId)
        .eq("business_id", deal.business_id)
        .maybeSingle();
      if (!cancelled) setIsFavorite(!!fav);
    })();
    return () => { cancelled = true; };
  }, [userId, deal?.business_id]);

  // MVP open tracking: count once per loaded deal detail view.
  useEffect(() => {
    if (!deal?.id || !deal.business_id) return;
    if (openedDealIdRef.current === deal.id) return;
    openedDealIdRef.current = deal.id;
    trackAppAnalyticsEvent({
      event_name: "deal_opened",
      deal_id: deal.id,
      business_id: deal.business_id,
    });
  }, [deal?.id, deal?.business_id]);

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
      // FIX: Add a 15s client-side timeout so the UI never gets stuck on
      // "Claiming..." indefinitely if the Edge Function hangs or the network
      // drops. The server-side timeout is 45s which is too long for UX.
      const claimPromise = claimDeal(deal.id, telem);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Claim timed out — please try again.")), 15_000),
      );
      const out = await Promise.race([claimPromise, timeoutPromise]);
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
      setQrShortCode(out.short_code ?? null);
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
    if (!deal || !userId) return;
    if (refreshingQr) return;
    setRefreshingQr(true);
    try {
      // Look up existing active claim instead of creating a new one.
      const { data: existing } = await supabase
        .from("deal_claims")
        .select("token,expires_at,short_code")
        .eq("deal_id", deal.id)
        .eq("user_id", userId)
        .eq("claim_status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.token) {
        setQrToken(existing.token);
        setQrExpires(existing.expires_at);
        setQrShortCode(existing.short_code ?? null);
      } else {
        setBanner(t("dealDetail.noActiveClaim"));
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : t("commonUi.genericError");
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
        <ScreenHeader title={t("dealDetail.title")} />
        <Text style={{ marginTop: Spacing.md, opacity: 0.8, color: theme.text }}>{t("dealDetail.loading")}</Text>
      </View>
    );
  }

  if (loadStatus === "failed" || !deal) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, gap: Spacing.lg }}>
        <ScreenHeader title={t("dealDetail.title")} />
        {banner ? <Banner message={banner} tone="error" /> : null}
        <Text style={{ opacity: 0.78, fontSize: 16, lineHeight: 24, color: theme.text }}>{t("dealDetail.couldNotLoad")}</Text>
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
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      {banner ? <Banner message={banner} tone="error" /> : null}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: scrollBottom }}
      >
        <ScreenHeader title={t("dealDetail.title")} />
        <Pressable
          onPress={toggleFavorite}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.sm,
            marginBottom: Spacing.md,
            marginTop: Spacing.sm,
            minHeight: 44,
          }}
        >
          <MaterialIcons
            name={isFavorite ? "favorite" : "favorite-border"}
            size={22}
            color={isFavorite ? "#e0245e" : theme.mutedText}
          />
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}>
            {isFavorite ? t("dealDetail.favorited") : t("dealDetail.favorite")}
          </Text>
        </Pressable>
        {(() => {
          const posterUri = resolveDealPosterDisplayUri(deal.poster_url, deal.poster_storage_path);
          return posterUri ? (
            <Image
              source={{ uri: posterUri }}
              style={{ height: heroHeight, width: "100%", borderRadius: Radii.card }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                height: heroHeight,
                borderRadius: Radii.card,
                backgroundColor: theme.surfaceMuted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: theme.mutedText, fontSize: 15 }}>{t("dealDetail.noImage")}</Text>
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
              color: theme.text,
              flex: 1,
            }}
          >
            {deal.businesses?.name ?? t("dealDetail.localBusiness")}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push(`/business/${deal.business_id}` as Href)}
          accessibilityRole="button"
          style={{ marginTop: Spacing.xs, marginBottom: Spacing.sm, alignSelf: "flex-start" }}
        >
          <Text style={{ color: theme.primary, fontWeight: "700", fontSize: 15 }}>{t("consumerHome.shopInfoLink")}</Text>
        </Pressable>
        <Text style={{ fontSize: 24, fontWeight: "700", marginTop: Spacing.xs, lineHeight: 30, color: theme.text }}>
          {deal.title ?? t("dealDetail.dealFallback")}
        </Text>
        {deal.price != null ? (
          <Text style={{ marginTop: Spacing.sm, fontWeight: "700", fontSize: 20, color: theme.text }}>
            ${deal.price.toFixed(2)}
          </Text>
        ) : null}
        {deal.description ? (
          <Text style={{ marginTop: Spacing.md, fontSize: 16, lineHeight: 24, color: theme.text }}>{deal.description}</Text>
        ) : null}
        <View
          style={{
            marginTop: Spacing.lg,
            borderRadius: Radii.lg,
            backgroundColor: theme.surfaceMuted,
            padding: Spacing.lg,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm, fontSize: 16, color: theme.text }}>
            {t("dealDetail.finePrint")}
          </Text>
          <Text style={{ opacity: 0.78, fontSize: 15, lineHeight: 22, color: theme.text }}>
            {t("dealDetail.validityPrefix")}{" "}
            {formatValiditySummary(deal, {
              lang: i18n.language,
              endsVerb: t("commonUi.dealEndsVerb"),
              t,
            })}
          </Text>
          <Text style={{ opacity: 0.78, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22, color: theme.text }}>
            {t("dealDetail.cutoffPrefix")} {deal.claim_cutoff_buffer_minutes} {t("dealDetail.cutoffSuffix")}
          </Text>
          <Text style={{ opacity: 0.78, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22, color: theme.text }}>
            {t("dealDetail.claimsRemaining")} {remaining} / {deal.max_claims}
          </Text>
        </View>

        <View style={{ marginTop: Spacing.xl, gap: Spacing.md }}>
          <PrimaryButton
            title={isClaiming ? t("dealDetail.claiming") : t("dealDetail.claim")}
            onPress={doClaim}
            disabled={isClaiming}
          />
          <Pressable
            onPress={refreshQr}
            disabled={refreshingQr}
            accessibilityRole="button"
            style={{ paddingVertical: Spacing.sm, alignItems: "center", opacity: refreshingQr ? 0.6 : 1 }}
          >
            <Text style={{ color: theme.primary, fontWeight: "700", fontSize: 15 }}>
              {refreshingQr ? t("dealDetail.refreshingQr") : t("dealDetail.refreshQr")}
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => setReportVisible(true)}
          accessibilityRole="button"
          style={{
            marginTop: Spacing.xl,
            paddingVertical: Spacing.md,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: theme.mutedText }}>
            {t("dealDetail.reportBusinessLink", { defaultValue: "Report this business" })}
          </Text>
        </Pressable>
      </ScrollView>

      <ReportSheet
        visible={reportVisible}
        mode="business"
        subjectLabel={deal.businesses?.name ?? t("dealDetail.localBusiness")}
        onDismiss={() => setReportVisible(false)}
        onSubmit={async ({ reason, comment }) => {
          const result = await submitBusinessReport({
            businessId: deal.business_id,
            reason: reason as BusinessReportReason,
            comment,
            dealId: deal.id,
          });
          return { ok: result.ok };
        }}
      />

      <QrModal
        visible={qrVisible}
        token={qrToken}
        expiresAt={qrExpires}
        shortCode={qrShortCode}
        successToastNonce={claimSuccessToastNonce}
        onHide={() => setQrVisible(false)}
        onRefresh={refreshQr}
        refreshing={refreshingQr}
      />
    </View>
  );
}
