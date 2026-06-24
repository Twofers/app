import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
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
import { formatValiditySummary, getDealClaimScheduleBlock, type DealClaimScheduleBlockReason } from "../../lib/deal-time";
import { translateKnownApiMessage } from "../../lib/i18n/api-messages";
import { resolveDealPosterDisplayUri } from "../../lib/deal-poster-url";
import { localizedDealDescription, localizedDealTitle } from "@/lib/deal-localization";
import {
  DEAL_STRUCTURED_DISPLAY_COLUMNS,
  isMissingStructuredDisplayColumnError,
  type DealStructuredDisplayFields,
} from "@/lib/deal-feed-schema";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { ReportSheet } from "@/components/report-sheet";
import { hasDirectionsTarget, openDirectionsToTarget } from "@/lib/directions";
import { submitBusinessReport, type BusinessReportReason } from "@/lib/reports";
import { isShareDealEnabled } from "@/lib/runtime-env";
import { DemoOfferNotice } from "@/components/demo-offer-notice";
import { DEMO_OFFER_DETAIL_EXPLANATION, DEMO_OFFER_LABEL, isDemoOffer } from "@/lib/demo-content";
import { getDealDetailActionState } from "@/lib/deal-action-state";

type Deal = DealStructuredDisplayFields & {
  id: string;
  title: string | null;
  description: string | null;
  source_locale: string | null;
  title_en: string | null;
  title_es: string | null;
  title_ko: string | null;
  description_en: string | null;
  description_es: string | null;
  description_ko: string | null;
  end_time: string;
  start_time: string;
  is_demo?: boolean | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  business_id: string;
  price: number | null;
  claim_cutoff_buffer_minutes: number;
  max_claims: number;
  businesses?: {
    name: string | null;
    address: string | null;
    location: string | null;
    latitude: number | string | null;
    longitude: number | string | null;
    is_demo?: boolean | null;
  } | null;
  is_recurring?: boolean;
  days_of_week?: number[] | null;
  window_start_minutes?: number | null;
  window_end_minutes?: number | null;
  timezone?: string | null;
};

const DEAL_DETAIL_BASE_SELECT =
  "id,title,description,source_locale,title_en,title_es,title_ko,description_en,description_es,description_ko,end_time,start_time,is_demo,poster_url,poster_storage_path,business_id,price,claim_cutoff_buffer_minutes,max_claims,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone,businesses(name,address,location,latitude,longitude,is_demo)";
const DEAL_DETAIL_SELECT = `${DEAL_DETAIL_BASE_SELECT},${DEAL_STRUCTURED_DISPLAY_COLUMNS}`;

type ActiveClaim = {
  id?: string;
  token: string;
  expires_at: string;
  short_code: string | null;
};

function labelForClaimScheduleBlock(reason: DealClaimScheduleBlockReason, t: (key: string) => string) {
  switch (reason) {
    case "not_started":
      return t("dealDetail.notStartedYet");
    case "expired":
      return t("dealDetail.expired");
    case "claim_closed":
      return t("dealDetail.claimClosed");
    case "not_active_today":
      return t("dealDetail.notActiveToday");
    case "not_active_now":
      return t("dealDetail.notActiveRightNow");
    case "claim_window_closed":
      return t("dealDetail.claimWindowClosedToday");
    case "misconfigured":
      return t("dealDetail.unavailable");
  }
}

function messageFromThrown(value: unknown): string | null {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function DealDetail() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { height: winH } = useWindowDimensions();
  const { top, horizontal, scrollBottom, insets } = useScreenInsets("stack");
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
  const [activeClaim, setActiveClaim] = useState<ActiveClaim | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [claimSuccessToastNonce, setClaimSuccessToastNonce] = useState(0);
  const [isClaiming, setIsClaiming] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const openedDealIdRef = useRef<string | null>(null);
  const [claimsCount, setClaimsCount] = useState(0);
  /** True only when claimsCount came from the deal_claim_counts RPC (full total, not own-claims-only). */
  const [claimsCountReliable, setClaimsCountReliable] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const shareDealEnabled = isShareDealEnabled();

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)" as Href);
    }
  }, [router]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (qrVisible) {
        setQrVisible(false);
        return true;
      }
      if (reportVisible) {
        setReportVisible(false);
        return true;
      }
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [goBack, qrVisible, reportVisible]);

  function renderBackAction() {
    return (
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel={t("commonUi.goBack")}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{
          minHeight: 44,
          minWidth: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: Radii.lg,
          backgroundColor: theme.surfaceMuted,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <MaterialIcons name="arrow-back" size={24} color={theme.text} />
      </Pressable>
    );
  }

  const loadClaimCount = useCallback(async (dealId: string) => {
    // True total via the aggregate RPC (20260716120000). RLS hides other users'
    // claim rows, so the direct count below only ever sees the caller's own
    // claim — kept as the legacy fallback until the migration is applied, and
    // never treated as reliable enough to pre-render "sold out".
    const { data: rpcData, error: rpcErr } = await supabase.rpc("deal_claim_counts", {
      p_deal_ids: [dealId],
    });
    if (!rpcErr && Array.isArray(rpcData)) {
      const row = (rpcData as { deal_id: string; claim_count: number }[]).find((r) => r.deal_id === dealId);
      setClaimsCount(row?.claim_count ?? 0);
      setClaimsCountReliable(true);
      return;
    }
    const { count, error } = await supabase
      .from("deal_claims")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    if (!error && typeof count === "number") {
      setClaimsCount(count);
    }
  }, []);

  const loadActiveClaimForDeal = useCallback(async (dealId: string, ownerUserId: string, attempts = 1): Promise<ActiveClaim | null> => {
    for (let i = 0; i < attempts; i++) {
      const { data } = await supabase
        .from("deal_claims")
        .select("id,token,expires_at,short_code")
        .eq("deal_id", dealId)
        .eq("user_id", ownerUserId)
        .eq("claim_status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.token) return data as ActiveClaim;
      if (i < attempts - 1) await sleep(800);
    }
    return null;
  }, []);

  function openClaimQr(claim: { id?: string; token: string; expires_at: string; short_code?: string | null }, showSuccessToast: boolean) {
    setQrToken(claim.token);
    setQrExpires(claim.expires_at);
    setQrShortCode(claim.short_code ?? null);
    setActiveClaim({
      id: claim.id,
      token: claim.token,
      expires_at: claim.expires_at,
      short_code: claim.short_code ?? null,
    });
    if (showSuccessToast) setClaimSuccessToastNonce((n) => n + 1);
    setQrVisible(true);
  }

  const loadDeal = useCallback(async () => {
    if (!id) {
      setLoadStatus("failed");
      return;
    }
    setLoadStatus("loading");
    setBanner(null);
    const enrichedResult = await supabase
      .from("deals")
      .select(DEAL_DETAIL_SELECT)
      .eq("id", id)
      .single();
    let dealDataResult: unknown = enrichedResult.data;
    let dealError = enrichedResult.error;
    if (isMissingStructuredDisplayColumnError(enrichedResult.error)) {
      const baseResult = await supabase
        .from("deals")
        .select(DEAL_DETAIL_BASE_SELECT)
        .eq("id", id)
        .single();
      dealDataResult = baseResult.data;
      dealError = baseResult.error;
    }
    if (dealError) {
      setDeal(null);
      setBanner(translateKnownApiMessage(dealError.message, t));
      setLoadStatus("failed");
      return;
    }
    const dealData = dealDataResult as Deal;
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

  useEffect(() => {
    if (!userId || !deal?.id) {
      setActiveClaim(null);
      return;
    }
    let cancelled = false;
    setActiveClaim(null);
    (async () => {
      const existing = await loadActiveClaimForDeal(deal.id, userId);
      if (!cancelled) setActiveClaim(existing);
    })();
    return () => { cancelled = true; };
  }, [deal?.id, loadActiveClaimForDeal, userId]);

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
      if (isDemoOffer(deal)) {
        setBanner(DEMO_OFFER_DETAIL_EXPLANATION);
        return;
      }
      if (isClaiming) return;
      setIsClaiming(true);
      const claimPromise = (async () => {
        const telem = await buildClaimDealTelemetry(isFavorite ? "favorite" : "direct");
        return claimDeal(deal.id, telem);
      })();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(t("dealDetail.claimTimedOut"))), 15_000),
      );
      const out = await Promise.race([claimPromise, timeoutPromise]);
      if (out.claim_id) {
        trackAppAnalyticsEvent({
          event_name: "deal_claimed",
          deal_id: deal.id,
          business_id: deal.business_id,
          claim_id: out.claim_id,
        });
      }
      openClaimQr(out, true);
      void loadClaimCount(deal.id);
    } catch (e: unknown) {
      const msg = messageFromThrown(e) ?? t("apiErrors.operationFailedTryAgain");
      if (deal && userId) {
        const existing = await loadActiveClaimForDeal(deal.id, userId, 4);
        if (existing) {
          setBanner(null);
          openClaimQr(existing, true);
          void loadClaimCount(deal.id);
          return;
        }
      }
      setBanner(translateKnownApiMessage(msg, t));
    } finally {
      setIsClaiming(false);
    }
  }

  async function viewQr() {
    if (deal && isDemoOffer(deal)) {
      setBanner(DEMO_OFFER_DETAIL_EXPLANATION);
      return;
    }
    if (activeClaim) {
      openClaimQr(activeClaim, false);
      return;
    }
    if (!deal || !userId) return;
    if (refreshingQr) return;
    setRefreshingQr(true);
    try {
      // Look up existing active claim instead of creating a new one.
      const existing = await loadActiveClaimForDeal(deal.id, userId);
      if (existing) {
        setActiveClaim(existing);
        openClaimQr(existing, false);
      } else {
        setBanner(t("dealDetail.noActiveClaim"));
      }
    } catch (e: unknown) {
      const msg = messageFromThrown(e) ?? t("apiErrors.operationFailedTryAgain");
      setBanner(translateKnownApiMessage(msg, t));
    } finally {
      setRefreshingQr(false);
    }
  }

  async function handleShare() {
    if (!shareDealEnabled) return;
    if (!deal || isSharing) return;
    if (isDemoOffer(deal)) {
      setBanner(DEMO_OFFER_DETAIL_EXPLANATION);
      return;
    }
    setIsSharing(true);
    setBanner(null);
    setShareError(null);
    try {
      const { buildShareCopy, getOrCreateShareCode, openShareSheet } = await import("@/lib/share-deal");
      const code = await getOrCreateShareCode(deal.id);
      const copy = buildShareCopy({
        shareCode: code,
        dealTitle: localizedDealTitle(deal, i18n.language) || t("dealDetail.dealFallback"),
        businessName: deal.businesses?.name ?? t("dealDetail.localBusiness"),
        t,
      });
      await openShareSheet(copy);
    } catch {
      const message = t("shareDeal.errCreateLink", { defaultValue: "Couldn't create share link. Try again." });
      setShareError(message);
      setBanner(message);
    } finally {
      setIsSharing(false);
    }
  }

  async function handleDirections() {
    const result = await openDirectionsToTarget(deal?.businesses ?? null);
    if (result !== "opened") {
      setBanner(
        t("businessProfile.mapsOpenFailed", {
          defaultValue: "We couldn't open maps. Try the address from this page.",
        }),
      );
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
        <ScreenHeader title={t("dealDetail.title")} leftSlot={renderBackAction()} />
        <Text style={{ marginTop: Spacing.md, opacity: 0.8, color: theme.text }}>{t("dealDetail.loading")}</Text>
      </View>
    );
  }

  if (loadStatus === "failed" || !deal) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, gap: Spacing.lg }}>
        <ScreenHeader title={t("dealDetail.title")} leftSlot={renderBackAction()} />
        {banner ? <Banner message={banner} tone="error" /> : null}
        <Text style={{ opacity: 0.78, fontSize: 16, lineHeight: 24, color: theme.text }}>{t("dealDetail.couldNotLoad")}</Text>
        <SecondaryButton title={t("commonUi.goBack")} onPress={goBack} />
      </View>
    );
  }

  const remaining = Math.max(0, deal.max_claims - claimsCount);
  const dealIsDemo = isDemoOffer(deal);
  // Pre-rendered claim states so the user sees sold out / closed / not-started
  // before tapping. Client-side mirror only — the server checks in claim-deal
  // stay authoritative. Sold out requires the reliable RPC total: the fallback
  // count only sees the caller's own claims.
  const scheduleBlockReason = getDealClaimScheduleBlock(deal);
  const claimBlockedLabel =
    dealIsDemo
      ? DEMO_OFFER_LABEL
      : claimsCountReliable && deal.max_claims > 0 && remaining <= 0
      ? t("dealDetail.soldOut")
      : scheduleBlockReason
        ? labelForClaimScheduleBlock(scheduleBlockReason, t)
        : null;
  const heroHeight = Math.round(Math.min(280, Math.max(180, winH * 0.28)));
  const displayTitle = localizedDealTitle(deal, i18n.language) || t("dealDetail.dealFallback");
  const displayDescription = localizedDealDescription(deal, i18n.language);
  const actionState = getDealDetailActionState({
    hasActiveClaim: Boolean(activeClaim),
    isClaiming,
    unavailableLabel: claimBlockedLabel,
  });
  const canShareDeal = shareDealEnabled && !dealIsDemo && actionState.kind !== "unavailable";
  const stickyBottom = Math.max(insets.bottom, Spacing.lg);
  const stickyBarHeight = 76;
  const ctaLabel =
    actionState.kind === "active_claimed"
      ? t("dealDetail.viewYourDeal", { defaultValue: "View your deal" })
      : actionState.kind === "unavailable"
        ? scheduleBlockReason === "expired" || scheduleBlockReason === "claim_closed"
          ? t("dealDetail.dealEnded", { defaultValue: "Deal ended" })
          : actionState.statusLabel
        : actionState.kind === "claiming"
          ? t("dealDetail.claiming")
          : t("dealDetail.claim");
  const ctaDisabled = actionState.kind === "claiming" || actionState.kind === "unavailable";
  const ctaPress = actionState.kind === "active_claimed" ? viewQr : doClaim;
  const biz = deal.businesses;
  const addressLine = biz?.address?.trim() || biz?.location?.trim() || null;
  const directionsAvailable = hasDirectionsTarget(biz);

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.md, marginBottom: Spacing.md }}>
        {renderBackAction()}
        <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
          <Pressable
            onPress={toggleFavorite}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? t("dealDetail.removeSavedDeal", { defaultValue: "Remove saved deal" }) : t("dealDetail.saveDeal", { defaultValue: "Save deal" })}
            accessibilityState={{ selected: isFavorite }}
            style={{
              minHeight: 44,
              minWidth: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: Radii.lg,
              backgroundColor: isFavorite ? theme.surface : theme.surfaceMuted,
              borderWidth: 1,
              borderColor: isFavorite ? theme.favorite : theme.border,
            }}
          >
            <MaterialIcons
              name={isFavorite ? "favorite" : "favorite-border"}
              size={23}
              color={isFavorite ? theme.favorite : theme.text}
            />
          </Pressable>
          {shareDealEnabled ? (
            <Pressable
              onPress={handleShare}
              disabled={!canShareDeal || isSharing}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t("shareDeal.shareDeal", { defaultValue: "Share deal" })}
              style={{
                minHeight: 44,
                minWidth: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: Radii.lg,
                backgroundColor: theme.surfaceMuted,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: !canShareDeal || isSharing ? 0.5 : 1,
              }}
            >
              <MaterialIcons name="ios-share" size={22} color={theme.text} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {banner ? <Banner message={banner} tone="error" /> : null}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: scrollBottom + stickyBarHeight + stickyBottom }}
      >
        <Text style={{ fontSize: 28, fontWeight: "800", lineHeight: 34, color: theme.text }} maxFontSizeMultiplier={1.15}>
          {displayTitle}
        </Text>
        {(() => {
          const posterUri = resolveDealPosterDisplayUri(deal.poster_url, deal.poster_storage_path);
          return posterUri ? (
            <Image
              source={{ uri: posterUri }}
              style={{ height: heroHeight, width: "100%", borderRadius: Radii.lg, marginTop: Spacing.lg }}
              contentFit="cover"
            />
          ) : (
            <View
              style={{
                height: heroHeight,
                borderRadius: Radii.lg,
                marginTop: Spacing.lg,
                backgroundColor: theme.surfaceMuted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: theme.mutedText, fontSize: 15 }}>{t("dealDetail.noImage")}</Text>
            </View>
          );
        })()}

        <View style={{ marginTop: Spacing.lg }}>
          <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: "800", color: theme.text }}>
            {t("dealDetail.whereToGo", { defaultValue: "Where to go" })}
          </Text>
          <Pressable
            onPress={() => router.push(`/business/${deal.business_id}` as Href)}
            accessibilityRole="button"
            style={{ marginTop: Spacing.sm, alignSelf: "flex-start", maxWidth: "100%" }}
          >
            <Text style={{ color: theme.text, fontWeight: "800", fontSize: 16 }} numberOfLines={1}>
              {deal.businesses?.name ?? t("dealDetail.localBusiness")}
            </Text>
          </Pressable>
          {addressLine ? (
            <Text style={{ color: theme.mutedText, fontSize: 14, marginTop: Spacing.xs }} numberOfLines={1}>
              {addressLine}
            </Text>
          ) : null}
          {directionsAvailable ? (
            <Pressable
              onPress={() => void handleDirections()}
              accessibilityRole="button"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ marginTop: Spacing.sm, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: Spacing.xs }}
            >
              <MaterialIcons name="directions" size={18} color={theme.accentText} />
              <Text style={{ color: theme.accentText, fontWeight: "800", fontSize: 15 }}>
                {t("dealDetail.getDirections", { defaultValue: "Get directions" })}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {dealIsDemo ? (
          <View style={{ marginTop: Spacing.md }}>
            <DemoOfferNotice detail />
          </View>
        ) : null}
        {deal.price != null ? (
          <Text style={{ marginTop: Spacing.sm, fontWeight: "700", fontSize: 20, color: theme.text }}>
            ${deal.price.toFixed(2)}
          </Text>
        ) : null}
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={{ fontWeight: "800", marginBottom: Spacing.sm, fontSize: 18, color: theme.text }}>
            {t("dealDetail.dealDetails", { defaultValue: "Deal details" })}
          </Text>
          {displayDescription ? (
            <Text style={{ fontSize: 16, lineHeight: 24, color: theme.text }}>{displayDescription}</Text>
          ) : null}
          <Text style={{ opacity: 0.78, marginTop: displayDescription ? Spacing.sm : 0, fontSize: 15, lineHeight: 22, color: theme.text }}>
            {t("dealDetail.claimsAvailable", { count: remaining })}
          </Text>
          <Text style={{ opacity: 0.78, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22, color: theme.text }}>
            {formatValiditySummary(deal, {
              lang: i18n.language,
              endsVerb: t("commonUi.dealEndsVerb"),
              t,
              showTimeZone: false,
            })}
          </Text>
          <Text style={{ opacity: 0.78, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22, color: theme.text }}>
            {deal.claim_cutoff_buffer_minutes > 0
              ? t("dealDetail.claimingClosesBeforeEnd", { count: deal.claim_cutoff_buffer_minutes })
              : t("dealDetail.claimingOpenUntilEnd")}
          </Text>
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

      <View
        style={{
          position: "absolute",
          left: horizontal,
          right: horizontal,
          bottom: stickyBottom,
          minHeight: stickyBarHeight,
          justifyContent: "center",
          paddingTop: Spacing.sm,
          paddingBottom: Spacing.sm,
          backgroundColor: theme.background,
        }}
      >
        <PrimaryButton
          title={ctaLabel}
          onPress={() => void ctaPress()}
          disabled={ctaDisabled || dealIsDemo}
          style={ctaDisabled ? { backgroundColor: theme.surfaceMuted } : undefined}
        />
      </View>

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
        onRefresh={viewQr}
        refreshing={refreshingQr}
        onShare={shareDealEnabled ? handleShare : undefined}
        sharing={shareDealEnabled ? isSharing : undefined}
        shareError={shareDealEnabled ? shareError : undefined}
      />
    </View>
  );
}
