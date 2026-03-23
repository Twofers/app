import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { supabase } from "../../lib/supabase";
import { claimDeal } from "../../lib/functions";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { QrModal } from "../../components/qr-modal";
import { useBusiness } from "../../hooks/use-business";
import { formatValiditySummary } from "../../lib/deal-time";

type Deal = {
  id: string;
  title: string | null;
  description: string | null;
  end_time: string;
  start_time: string;
  poster_url: string | null;
  business_id: string;
  price: number | null;
  claim_cutoff_buffer_minutes: number;
  max_claims: number;
  businesses?: {
    name: string | null;
  } | null;
};

export default function DealDetail() {
  const { t } = useTranslation();
  const { height: winH } = useWindowDimensions();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { id } = useLocalSearchParams<{ id: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const { isLoggedIn, userId } = useBusiness();
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
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
    if (!id) return;
    const { data, error } = await supabase
      .from("deals")
      .select("id,title,description,end_time,start_time,poster_url,business_id,price,claim_cutoff_buffer_minutes,max_claims,businesses(name)")
      .eq("id", id)
      .single();
    if (error) {
      setBanner(error.message);
      return;
    }
    const dealData = data as unknown as Deal;
    setDeal(dealData);
    await loadClaimCount(dealData.id);
  }, [id, loadClaimCount]);

  useEffect(() => {
    void loadDeal();
  }, [loadDeal]);

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
      const out = await claimDeal(deal.id);
      setQrToken(out.token);
      setQrExpires(out.expires_at);
      setQrVisible(true);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : typeof e === "string"
          ? e
          : JSON.stringify(e, null, 2);
      setBanner(msg);
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
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : typeof e === "string"
          ? e
          : JSON.stringify(e, null, 2);
      setBanner(msg);
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
        setBanner(error.message);
      }
    } else {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("user_id", userId)
        .eq("business_id", deal.business_id);
      if (error) {
        setIsFavorite(!next);
        setBanner(error.message);
      }
    }
  }

  if (!deal) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("dealDetail.title")}</Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.8 }}>{t("dealDetail.loading")}</Text>
      </View>
    );
  }

  const remaining = Math.max(0, deal.max_claims - claimsCount);
  const heroHeight = Math.round(Math.min(380, Math.max(240, winH * 0.38)));

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
          hitSlop={8}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.sm,
            marginBottom: Spacing.md,
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
        {deal.poster_url ? (
          <Image
            source={{ uri: deal.poster_url }}
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
        )}

        <Text
          style={{
            marginTop: Spacing.lg,
            fontSize: 13,
            fontWeight: "600",
            opacity: 0.55,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {deal.businesses?.name ?? "Local business"}
        </Text>
        <Text style={{ fontSize: 24, fontWeight: "700", marginTop: Spacing.xs, lineHeight: 30 }}>
          {deal.title ?? "Deal"}
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
            {t("dealDetail.validityPrefix")} {formatValiditySummary(deal)}
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
        onHide={() => setQrVisible(false)}
        onRefresh={refreshQr}
        refreshing={refreshingQr}
      />
    </View>
  );
}
