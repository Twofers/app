import { useCallback, useMemo, useState } from "react";
import { RefreshControl, SectionList, Text, View } from "react-native";
import { Image } from "expo-image";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { formatAppDateTime } from "@/lib/i18n/format-datetime";
import { formatDealExpiryLocal } from "@/lib/format-deal-expiry";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { supabase } from "@/lib/supabase";
import { claimDeal, beginVisualRedeem, finalizeStaleRedeems } from "@/lib/functions";
import {
  DEFAULT_CLAIM_GRACE_MINUTES,
  getClaimRedeemDeadlineIso,
  isPastClaimRedeemDeadline,
} from "@/lib/claim-redeem-deadline";
import { buildClaimDealTelemetry } from "@/lib/claim-telemetry";
import { trackAppAnalyticsEvent } from "@/lib/app-analytics";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { logPostgrestError } from "@/lib/supabase-client-log";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PrimaryButton } from "@/components/ui/primary-button";
import { WalletRedeemModal } from "@/components/wallet-redeem-modal";
import { WalletVisualPassModal } from "@/components/wallet-visual-pass";
import { WalletUseDealSlideModal } from "@/components/wallet-use-deal-slide-modal";
import { useBusiness } from "@/hooks/use-business";
import { useSecondTick } from "@/hooks/use-second-tick";
import { formatConsumerCountdown } from "@/lib/consumer-countdown";
import { DealStatusPill } from "@/components/deal-status-pill";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";

type ClaimRow = {
  id: string;
  token: string;
  short_code: string | null;
  expires_at: string;
  redeemed_at: string | null;
  created_at: string;
  deal_id: string;
  claim_status: string | null;
  redeem_method: string | null;
  grace_period_minutes: number | null;
  deals: {
    id: string;
    business_id: string;
    title: string | null;
    poster_url: string | null;
    poster_storage_path?: string | null;
    end_time: string;
    price: number | null;
    timezone: string | null;
    businesses: { name: string | null } | null;
  } | null;
};

type BeginPayload = {
  server_now: string;
  redeem_started_at: string;
  min_complete_at: string;
};

function claimNotRedeemable(row: ClaimRow, now: number) {
  const grace = row.grace_period_minutes ?? DEFAULT_CLAIM_GRACE_MINUTES;
  return isPastClaimRedeemDeadline(row.expires_at, now, grace);
}

function classifyClaimBlockReason(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already have an active claim")) return "active_app_wide_claim";
  if (m.includes("once per business per local day") && m.includes("redeemable")) return "business_daily_limit";
  if (m.includes("once per business per day")) return "business_daily_limit"; // legacy fallback
  if (m.includes("active claim from this business")) return "active_business_claim";
  if (m.includes("active claim for this deal")) return "duplicate_deal_claim";
  if (m.includes("reached its claim limit") || m.includes("sold out")) return "deal_sold_out";
  if (m.includes("claiming has closed") || m.includes("expired")) return "deal_closed";
  return "unknown";
}

type EndedKind = "redeemed" | "expired" | "canceled";

type EndedListItem = { row: ClaimRow; kind: EndedKind };

type WalletListSection =
  | { key: "active"; title: string; data: ClaimRow[] }
  | { key: "ended"; title: string; data: EndedListItem[] };

type WalletListItem = ClaimRow | EndedListItem;

type UseDealState =
  | null
  | { row: ClaimRow; begin: null }
  | { row: ClaimRow; begin: BeginPayload };

export default function WalletScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { isLoggedIn, userId } = useBusiness();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const nowMs = useSecondTick();
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrShortCode, setQrShortCode] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrClaimedAt, setQrClaimedAt] = useState<string | null>(null);
  const [qrBusinessName, setQrBusinessName] = useState("");
  const [qrDealTitle, setQrDealTitle] = useState("");
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [claimingRefreshId, setClaimingRefreshId] = useState<string | null>(null);
  const [useDealState, setUseDealState] = useState<UseDealState>(null);
  const [useDealBusy, setUseDealBusy] = useState(false);

  const loadClaims = useCallback(async () => {
    if (!userId) {
      setClaims([]);
      setLoading(false);
      return;
    }
    setBanner(null);
    await finalizeStaleRedeems();
    const { data, error } = await supabase
      .from("deal_claims")
      .select(
        "id,token,short_code,expires_at,redeemed_at,created_at,deal_id,claim_status,redeem_method,grace_period_minutes,deals(id,business_id,title,poster_url,poster_storage_path,end_time,price,timezone,businesses(name))",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(120);

    if (error) {
      logPostgrestError("wallet deal_claims", error);
      setBanner(t("consumerWallet.loadError"));
      setClaims([]);
      setLoading(false);
      return;
    }
    setClaims((data ?? []) as unknown as ClaimRow[]);
    setLoading(false);
  }, [userId, t]);

  useFocusEffect(
    useCallback(() => {
      trackAppAnalyticsEvent({ event_name: "wallet_opened" });
      setLoading(true);
      void loadClaims();
    }, [loadClaims]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await loadClaims();
    setRefreshing(false);
  }

  function openVerifyForClaim(row: ClaimRow) {
    const dead = claimNotRedeemable(row, nowMs);
    if (dead || row.redeemed_at) return;
    if (row.claim_status === "redeeming") return;
    setQrToken(row.token);
    setQrShortCode(row.short_code);
    setQrExpires(getClaimRedeemDeadlineIso(row.expires_at, row.grace_period_minutes ?? DEFAULT_CLAIM_GRACE_MINUTES));
    setQrClaimedAt(row.created_at);
    setQrBusinessName(businessName(row));
    setQrDealTitle(dealTitle(row));
    setActiveDealId(row.deal_id);
    setQrVisible(true);
  }

  async function refreshQr() {
    if (!activeDealId) {
      setBanner(t("consumerWallet.errNoDealForQr"));
      return;
    }
    if (refreshingQr) return;
    setRefreshingQr(true);
    setBanner(null);
    try {
      const telem = await buildClaimDealTelemetry("unknown");
      const out = await claimDeal(activeDealId, telem);
      const businessIdForDeal = claims.find((c) => c.deal_id === activeDealId)?.deals?.business_id ?? null;
      trackAppAnalyticsEvent({
        event_name: "deal_claimed",
        claim_id: out.claim_id ?? null,
        deal_id: activeDealId,
        business_id: businessIdForDeal,
      });
      setQrToken(out.token);
      setQrExpires(getClaimRedeemDeadlineIso(out.expires_at, DEFAULT_CLAIM_GRACE_MINUTES));
      setQrShortCode(out.short_code ?? null);
      await loadClaims();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("consumerWallet.errRefreshQr");
      const businessIdForDeal = claims.find((c) => c.deal_id === activeDealId)?.deals?.business_id ?? null;
      trackAppAnalyticsEvent({
        event_name: "claim_blocked",
        deal_id: activeDealId,
        business_id: businessIdForDeal,
        context: { reason: classifyClaimBlockReason(msg) },
      });
      setBanner(translateKnownApiMessage(msg, t));
    } finally {
      setRefreshingQr(false);
    }
  }

  async function refreshClaimFromRow(row: ClaimRow) {
    if (claimingRefreshId) return;
    setClaimingRefreshId(row.id);
    setBanner(null);
    try {
      const telem = await buildClaimDealTelemetry("unknown");
      const out = await claimDeal(row.deal_id, telem);
      trackAppAnalyticsEvent({
        event_name: "deal_claimed",
        claim_id: out.claim_id ?? null,
        deal_id: row.deal_id,
        business_id: row.deals?.business_id ?? null,
      });
      setQrToken(out.token);
      setQrExpires(getClaimRedeemDeadlineIso(out.expires_at, DEFAULT_CLAIM_GRACE_MINUTES));
      setQrShortCode(out.short_code ?? null);
      setQrClaimedAt(row.created_at);
      setQrBusinessName(businessName(row));
      setQrDealTitle(dealTitle(row));
      setActiveDealId(row.deal_id);
      setQrVisible(true);
      await loadClaims();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("consumerWallet.errRefreshQr");
      trackAppAnalyticsEvent({
        event_name: "claim_blocked",
        deal_id: row.deal_id,
        business_id: row.deals?.business_id ?? null,
        context: { reason: classifyClaimBlockReason(msg) },
      });
      setBanner(translateKnownApiMessage(msg, t));
    } finally {
      setClaimingRefreshId(null);
    }
  }

  function dealTitle(row: ClaimRow) {
    return row.deals?.title?.trim() || t("consumerWallet.dealFallback");
  }

  function businessName(row: ClaimRow) {
    return row.deals?.businesses?.name?.trim() || t("consumerWallet.localBusiness");
  }

  const { active, ended } = useMemo(() => {
    const now = nowMs;
    const a: ClaimRow[] = [];
    const e: EndedListItem[] = [];
    for (const c of claims) {
      if (c.redeemed_at || c.claim_status === "redeemed") {
        e.push({ row: c, kind: "redeemed" });
        continue;
      }
      if (c.claim_status === "canceled") {
        e.push({ row: c, kind: "canceled" });
        continue;
      }
      const expired = claimNotRedeemable(c, now) || c.claim_status === "expired";
      if (expired) {
        e.push({ row: c, kind: "expired" });
        continue;
      }
      a.push(c);
    }
    a.sort((x, y) => {
      const xDeadline = new Date(
        getClaimRedeemDeadlineIso(x.expires_at, x.grace_period_minutes ?? DEFAULT_CLAIM_GRACE_MINUTES),
      ).getTime();
      const yDeadline = new Date(
        getClaimRedeemDeadlineIso(y.expires_at, y.grace_period_minutes ?? DEFAULT_CLAIM_GRACE_MINUTES),
      ).getTime();
      return xDeadline - yDeadline;
    });
    e.sort((x, y) => new Date(y.row.created_at).getTime() - new Date(x.row.created_at).getTime());
    return { active: a, ended: e };
  }, [claims, nowMs]);

  const stats = useMemo(() => {
    let saved = 0;
    for (const { row: c } of ended) {
      if (c.redeemed_at) {
        const p = c.deals?.price;
        if (typeof p === "number" && Number.isFinite(p)) saved += p;
      }
    }
    const redeemedCount = ended.filter((x) => x.kind === "redeemed").length;
    return { redeemedCount, savedTotal: saved };
  }, [ended]);

  async function startUseDealFlow(row: ClaimRow) {
    setBanner(null);
    if (row.claim_status === "redeeming") {
      setUseDealBusy(true);
      try {
        const b = await beginVisualRedeem(row.id);
        trackAppAnalyticsEvent({
          event_name: "redeem_started",
          claim_id: row.id,
          deal_id: row.deal_id,
          business_id: row.deals?.business_id ?? null,
          context: { resumed: "1" },
        });
        setUseDealState({ row, begin: b });
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : t("consumerWallet.errBeginRedeem");
        setBanner(translateKnownApiMessage(String(raw), t));
        trackAppAnalyticsEvent({
          event_name: "redeem_failed",
          claim_id: row.id,
          deal_id: row.deal_id,
          business_id: row.deals?.business_id ?? null,
          context: { phase: "resume" },
        });
      } finally {
        setUseDealBusy(false);
      }
      return;
    }
    setUseDealState({ row, begin: null });
  }

  async function onSlideConfirmed() {
    const row = useDealState?.row;
    if (!row || useDealState.begin !== null) return;
    setUseDealBusy(true);
    setBanner(null);
    try {
      const b = await beginVisualRedeem(row.id);
      trackAppAnalyticsEvent({
        event_name: "redeem_started",
        claim_id: row.id,
        deal_id: row.deal_id,
        business_id: row.deals?.business_id ?? null,
      });
      setUseDealState({ row, begin: b });
      await loadClaims();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : t("consumerWallet.errBeginRedeem");
      setBanner(translateKnownApiMessage(String(raw), t));
      trackAppAnalyticsEvent({
        event_name: "redeem_failed",
        claim_id: row.id,
        deal_id: row.deal_id,
        business_id: row.deals?.business_id ?? null,
        context: { phase: "begin" },
      });
      setUseDealState(null);
    } finally {
      setUseDealBusy(false);
    }
  }

  function closeUseDealFlow() {
    setUseDealState(null);
    setUseDealBusy(false);
  }

  function renderClaimCard(row: ClaimRow, bucket: "active" | EndedKind) {
    const redeemed = !!row.redeemed_at;
    const tokenDead = claimNotRedeemable(row, nowMs);
    const tz = row.deals?.timezone;
    const redeemByIso = getClaimRedeemDeadlineIso(row.expires_at, row.grace_period_minutes ?? 10);
    const expiryShown = formatDealExpiryLocal(redeemByIso, tz, i18n.language);
    const isRedeeming = row.claim_status === "redeeming";
    const countdown =
      bucket === "active" && !redeemed && !tokenDead
        ? formatConsumerCountdown(redeemByIso, nowMs, t)
        : null;
    const remainingMs = new Date(redeemByIso).getTime() - nowMs;
    const urgent =
      bucket === "active" &&
      !redeemed &&
      !tokenDead &&
      remainingMs <= 15 * 60 * 1000;

    const shortLabel = row.short_code
      ? `${row.short_code.slice(0, 3)} ${row.short_code.slice(3)}`
      : t("consumerWallet.codeLegacyQrOnly");

    const pillStatus =
      bucket === "active"
        ? isRedeeming
          ? ("redeeming" as const)
          : ("claimed" as const)
        : bucket === "redeemed"
          ? ("redeemed" as const)
          : bucket === "canceled"
            ? ("canceled" as const)
            : ("expired" as const);

    return (
      <View
        style={{
          borderRadius: Radii.lg,
          backgroundColor:
            bucket === "active" && !redeemed && !tokenDead
              ? urgent
                ? "#fff7ed"
                : "#f8fafc"
              : theme.surface,
          padding: Spacing.md,
          marginBottom: Spacing.md,
          borderWidth: 1.5,
          borderColor:
            bucket === "active" && !redeemed && !tokenDead
              ? urgent
                ? "#fb923c"
                : "#86efac"
              : theme.border,
          boxShadow: "0px 3px 8px rgba(0,0,0,0.06)",
          elevation: 2,
        }}
      >
        {bucket === "active" && !redeemed && !tokenDead && countdown ? (
          <View
            style={{
              borderRadius: Radii.md,
              backgroundColor: urgent ? "#7c2d12" : "#14532d",
              paddingVertical: Spacing.sm,
              paddingHorizontal: Spacing.md,
              marginBottom: Spacing.md,
              borderWidth: 1,
              borderColor: urgent ? "#ea580c" : "#22c55e",
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: "800",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: urgent ? "#ffedd5" : "#dcfce7",
              }}
            >
              {urgent ? t("consumerWallet.redeemSoon") : t("consumerWallet.timeLeftHeading")}
            </Text>
            <Text
              style={{
                fontSize: 32,
                marginTop: 2,
                fontWeight: "900",
                color: "#fff",
                letterSpacing: -0.5,
              }}
            >
              {countdown}
            </Text>
            <Text style={{ fontSize: 12, color: urgent ? "#fed7aa" : "#bbf7d0", marginTop: 2 }}>
              {t("consumerWallet.redeemByCaption", { datetime: expiryShown })}
            </Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => {
            if (row.deals?.id) router.push(`/deal/${row.deals.id}`);
          }}
          disabled={!row.deals?.id}
          style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
        >
          <View style={{ flexDirection: "row", gap: Spacing.md }}>
            {(() => {
              const posterUri = resolveDealPosterDisplayUri(row.deals?.poster_url, row.deals?.poster_storage_path);
              return posterUri ? (
                <Image
                  source={{ uri: posterUri }}
                  style={{ width: 88, height: 110, borderRadius: 12, backgroundColor: "#eee" }}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={{
                    width: 88,
                    height: 110,
                    borderRadius: 12,
                    backgroundColor: "#ececec",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 11, opacity: 0.5 }}>—</Text>
                </View>
              );
            })()}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginBottom: Spacing.xs }}>
                <DealStatusPill status={pillStatus} />
              </View>
              <Text style={{ fontWeight: "700", fontSize: 16 }} numberOfLines={2}>
                {dealTitle(row)}
              </Text>
              <Text style={{ opacity: 0.65, marginTop: Spacing.xs, fontSize: 14 }} numberOfLines={1}>
                {businessName(row)}
              </Text>
              <Text style={{ opacity: 0.55, marginTop: Spacing.sm, fontSize: 12 }}>
                {t("consumerWallet.claimedRecord", {
                  datetime: formatAppDateTime(row.created_at, i18n.language),
                })}
              </Text>
              <Text style={{ opacity: 0.55, marginTop: 4, fontSize: 12 }}>
                {t("consumerWallet.expiresAtLabel", { datetime: expiryShown })}
              </Text>
              {bucket === "active" ? (
                <Text style={{ marginTop: Spacing.sm, fontSize: 13, fontWeight: "700", letterSpacing: 1 }}>
                  {t("consumerWallet.cardCodeLine", { code: shortLabel })}
                </Text>
              ) : null}
              {row.redeem_method === "visual" && bucket === "redeemed" ? (
                <Text style={{ marginTop: Spacing.xs, fontSize: 12, opacity: 0.55 }}>
                  {t("consumerWallet.redeemedViaVisual")}
                </Text>
              ) : null}
              {row.redeem_method === "qr" && bucket === "redeemed" ? (
                <Text style={{ marginTop: Spacing.xs, fontSize: 12, opacity: 0.55 }}>
                  {t("consumerWallet.redeemedViaQr")}
                </Text>
              ) : null}
              <Text style={{ marginTop: Spacing.sm, fontSize: 12, opacity: 0.55, lineHeight: 17 }}>
                {bucket === "active" && !redeemed && !tokenDead
                  ? t("consumerWallet.redeemByCaption", { datetime: expiryShown })
                  : t("consumerWallet.expiresLocal", { datetime: expiryShown })}
              </Text>
            </View>
          </View>
        </Pressable>
        {bucket === "active" && !redeemed && !tokenDead ? (
          <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
            <View
              style={{
                borderRadius: Radii.md,
                borderWidth: 1,
                borderColor: "#d1d5db",
                backgroundColor: "#fff",
                padding: Spacing.md,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.5, opacity: 0.65 }}>
                {t("consumerWallet.scanQrAtCounter")}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.md, marginTop: Spacing.sm }}>
                <View
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: "#111827",
                    borderStyle: "dashed",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#f9fafb",
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "700", opacity: 0.55 }}>QR</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, opacity: 0.58 }}>
                    {t("consumerWallet.verifyCodeLabel")}
                  </Text>
                  <Text style={{ fontSize: 20, fontWeight: "900", letterSpacing: 2.2, marginTop: 2 }}>
                    {shortLabel}
                  </Text>
                </View>
              </View>
            </View>
            <PrimaryButton
              title={isRedeeming ? t("consumerWallet.continueUseDeal") : t("consumerWallet.useDealCta")}
              onPress={() => void startUseDealFlow(row)}
              disabled={useDealBusy}
              style={{ backgroundColor: "#16a34a", borderRadius: Radii.lg }}
            />
            <Pressable
              onPress={() => openVerifyForClaim(row)}
              disabled={isRedeeming}
              accessibilityRole="button"
              style={{ paddingVertical: Spacing.sm, alignItems: "center", opacity: isRedeeming ? 0.45 : 1 }}
            >
              <Text style={{ color: theme.primary, fontWeight: "700", fontSize: 15 }}>
                {t("consumerWallet.qrFallbackLabel")}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {bucket === "active" && tokenDead && !redeemed ? (
          <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
            <Text style={{ fontSize: 13, opacity: 0.65 }}>{t("consumerWallet.qrExpired")}</Text>
            <PrimaryButton
              title={claimingRefreshId === row.id ? t("consumerWallet.refreshingQr") : t("consumerWallet.getNewQr")}
              onPress={() => void refreshClaimFromRow(row)}
              disabled={claimingRefreshId === row.id}
              style={{ backgroundColor: "#111", borderRadius: Radii.lg }}
            />
          </View>
        ) : null}
      </View>
    );
  }

  const sections: WalletListSection[] = useMemo(
    () => [
      { key: "active", title: t("consumerWallet.sectionActive"), data: active },
      {
        key: "ended",
        title: t("consumerWallet.sectionEnded"),
        data: ended,
      },
    ],
    [active, ended, t],
  );

  const showSlideModal = useDealState !== null && useDealState.begin === null;
  const showPassModal = useDealState !== null && useDealState.begin !== null;
  const passRow = showPassModal ? useDealState.row : null;
  const passBegin = showPassModal ? useDealState.begin : null;

  if (!isLoggedIn) {
    return <Redirect href="/auth-landing" />;
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={t("consumerWallet.title")} subtitle={t("consumerWallet.subtitle")} />

      {claims.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            gap: Spacing.md,
            marginTop: Spacing.md,
            marginBottom: Spacing.lg,
            borderRadius: Radii.lg,
            borderWidth: 1,
            borderColor: theme.border,
            padding: Spacing.md,
            backgroundColor: theme.surfaceMuted,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, opacity: 0.55, fontWeight: "600" }}>{t("consumerWallet.statRedeemed")}</Text>
            <Text style={{ fontSize: 22, fontWeight: "800", marginTop: 4 }}>{stats.redeemedCount}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, opacity: 0.55, fontWeight: "600" }}>{t("consumerWallet.statSaved")}</Text>
            <Text style={{ fontSize: 22, fontWeight: "800", marginTop: 4 }}>
              {t("consumerWallet.statSavedValue", { amount: stats.savedTotal.toFixed(2) })}
            </Text>
          </View>
        </View>
      ) : null}

      {banner ? <Banner message={banner} tone="error" /> : null}

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : claims.length === 0 ? (
        <EmptyState title={t("consumerWallet.emptyClaimsTitle")} message={t("consumerWallet.emptyClaimsSub")} />
      ) : (
        <SectionList<WalletListItem, WalletListSection>
          sections={sections}
          keyExtractor={(item) => ("row" in item ? item.row.id : item.id)}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
          renderSectionHeader={({ section }) => (
            <Text
              style={{
                fontSize: 16,
                fontWeight: "800",
                marginTop: section.key === "active" ? 0 : Spacing.md,
                marginBottom: Spacing.sm,
              }}
            >
              {section.title}
            </Text>
          )}
          renderItem={({ item, section }) => {
            if (section.key === "ended") {
              const { row, kind } = item as EndedListItem;
              return renderClaimCard(row, kind);
            }
            return renderClaimCard(item as ClaimRow, "active");
          }}
          renderSectionFooter={({ section }) => {
            if (section.data.length > 0) return null;
            const msg =
              section.key === "active"
                ? { title: t("consumerWallet.emptyActiveTitle"), sub: t("consumerWallet.emptyActiveSub") }
                : { title: t("consumerWallet.emptyEndedTitle"), sub: t("consumerWallet.emptyEndedSub") };
            return (
              <View style={{ marginBottom: Spacing.lg, opacity: 0.72 }}>
                <Text style={{ fontWeight: "600" }}>{msg.title}</Text>
                <Text style={{ marginTop: 4, fontSize: 14 }}>{msg.sub}</Text>
              </View>
            );
          }}
        />
      )}

      {showSlideModal && useDealState ? (
        <WalletUseDealSlideModal
          visible
          dealTitle={dealTitle(useDealState.row)}
          businessName={businessName(useDealState.row)}
          busy={useDealBusy}
          onConfirmSlide={() => void onSlideConfirmed()}
          onClose={() => !useDealBusy && closeUseDealFlow()}
        />
      ) : null}

      {passRow && passBegin ? (
        <WalletVisualPassModal
          visible={showPassModal}
          claimId={passRow.id}
          businessName={businessName(passRow)}
          dealTitle={dealTitle(passRow)}
          shortCode={passRow.short_code}
          token={passRow.token}
          claimedAt={passRow.created_at}
          redeemByIso={getClaimRedeemDeadlineIso(
            passRow.expires_at,
            passRow.grace_period_minutes ?? DEFAULT_CLAIM_GRACE_MINUTES,
          )}
          minCompleteAtIso={passBegin.min_complete_at}
          nowMs={nowMs}
          onClose={closeUseDealFlow}
          onRedeemed={() => {
            trackAppAnalyticsEvent({
              event_name: "redeem_completed",
              claim_id: passRow.id,
              deal_id: passRow.deal_id,
              business_id: passRow.deals?.business_id ?? null,
              context: { method: "visual" },
            });
            closeUseDealFlow();
            void loadClaims();
          }}
          onError={(msg) => {
            setBanner(translateKnownApiMessage(msg, t));
            trackAppAnalyticsEvent({
              event_name: "redeem_failed",
              claim_id: passRow.id,
              deal_id: passRow.deal_id,
              business_id: passRow.deals?.business_id ?? null,
              context: { phase: "complete" },
            });
            closeUseDealFlow();
            void loadClaims();
          }}
        />
      ) : null}

      {qrVisible ? (
        <WalletRedeemModal
          visible
          token={qrToken}
          shortCode={qrShortCode}
          expiresAt={qrExpires}
          claimedAt={qrClaimedAt}
          businessName={qrBusinessName}
          dealTitle={qrDealTitle}
          nowMs={nowMs}
          onHide={() => setQrVisible(false)}
          onRefresh={refreshQr}
          refreshing={refreshingQr}
        />
      ) : null}
    </View>
  );
}
