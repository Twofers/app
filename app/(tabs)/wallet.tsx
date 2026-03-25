import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { formatAppDateTime } from "@/lib/i18n/format-datetime";
import { formatDealExpiryLocal } from "@/lib/format-deal-expiry";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
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
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { WalletRedeemModal } from "@/components/wallet-redeem-modal";
import { WalletVisualPassModal } from "@/components/wallet-visual-pass";
import { WalletUseDealSlideModal } from "@/components/wallet-use-deal-slide-modal";
import { useBusiness } from "@/hooks/use-business";
import { useSecondTick } from "@/hooks/use-second-tick";
import { formatConsumerCountdown } from "@/lib/consumer-countdown";
import { DealStatusPill } from "@/components/deal-status-pill";

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
  const { isLoggedIn, sessionEmail, userId } = useBusiness();
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
        "id,token,short_code,expires_at,redeemed_at,created_at,deal_id,claim_status,redeem_method,grace_period_minutes,deals(id,business_id,title,poster_url,end_time,price,timezone,businesses(name))",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(120);

    if (error) {
      setBanner(error.message);
      setClaims([]);
      setLoading(false);
      return;
    }
    setClaims((data ?? []) as unknown as ClaimRow[]);
    setLoading(false);
  }, [userId]);

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
      setQrToken(out.token);
      setQrExpires(getClaimRedeemDeadlineIso(out.expires_at, DEFAULT_CLAIM_GRACE_MINUTES));
      setQrShortCode(out.short_code ?? null);
      await loadClaims();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("consumerWallet.errRefreshQr");
      setBanner(msg);
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
      setBanner(msg);
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
          borderRadius: 18,
          backgroundColor: "#fff",
          padding: Spacing.md,
          marginBottom: Spacing.md,
          shadowColor: "#000",
          shadowOpacity: 0.07,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        }}
      >
        <Pressable
          onPress={() => {
            if (row.deals?.id) router.push(`/deal/${row.deals.id}`);
          }}
          disabled={!row.deals?.id}
          style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
        >
          <View style={{ flexDirection: "row", gap: Spacing.md }}>
            {row.deals?.poster_url ? (
              <Image
                source={{ uri: row.deals.poster_url }}
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
            )}
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
              {countdown ? (
                <View
                  style={{
                    marginTop: Spacing.sm,
                    alignSelf: "flex-start",
                    backgroundColor: "#eff6ff",
                    paddingVertical: Spacing.sm,
                    paddingHorizontal: Spacing.md,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#bfdbfe",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      opacity: 0.55,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                    }}
                  >
                    {t("consumerWallet.timeLeftHeading")}
                  </Text>
                  <Text style={{ fontSize: 16, fontWeight: "800", marginTop: 2 }}>{countdown}</Text>
                </View>
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
            <Pressable
              onPress={() => void startUseDealFlow(row)}
              disabled={useDealBusy}
              style={{
                paddingVertical: Spacing.md,
                borderRadius: 14,
                backgroundColor: "#16a34a",
                opacity: useDealBusy ? 0.65 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900", textAlign: "center", fontSize: 17 }}>
                {isRedeeming ? t("consumerWallet.continueUseDeal") : t("consumerWallet.useDealCta")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => openVerifyForClaim(row)}
              disabled={isRedeeming}
              style={{
                paddingVertical: Spacing.sm,
                borderRadius: 12,
                backgroundColor: "#f4f4f5",
                opacity: isRedeeming ? 0.45 : 1,
              }}
            >
              <Text style={{ color: "#333", fontWeight: "700", textAlign: "center" }}>
                {t("consumerWallet.qrFallbackCta")}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {bucket === "active" && tokenDead && !redeemed ? (
          <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
            <Text style={{ fontSize: 13, opacity: 0.65 }}>{t("consumerWallet.qrExpired")}</Text>
            <Pressable
              onPress={() => void refreshClaimFromRow(row)}
              disabled={claimingRefreshId === row.id}
              style={{
                paddingVertical: Spacing.sm,
                borderRadius: 12,
                backgroundColor: "#111",
                opacity: claimingRefreshId === row.id ? 0.65 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700", textAlign: "center" }}>
                {claimingRefreshId === row.id ? t("consumerWallet.refreshingQr") : t("consumerWallet.getNewQr")}
              </Text>
            </Pressable>
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
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("consumerWallet.title")}</Text>
        <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.65, fontSize: 15, lineHeight: 22 }}>
          {t("consumerWallet.guestSubtitle")}
        </Text>
        <EmptyState title={t("consumerWallet.emptyLoginTitle")} message={t("consumerWallet.emptyLoginMessage")} />
      </View>
    );
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("consumerWallet.title")}</Text>
      <Text style={{ marginTop: Spacing.xs, opacity: 0.62, fontSize: 15, lineHeight: 22 }}>{t("consumerWallet.subtitle")}</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.55, fontSize: 14 }}>{sessionEmail ?? ""}</Text>

      <View
        style={{
          flexDirection: "row",
          gap: Spacing.md,
          marginBottom: Spacing.lg,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "#eee",
          padding: Spacing.md,
          backgroundColor: "#fafafa",
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

      <WalletUseDealSlideModal
        visible={showSlideModal && !!useDealState}
        dealTitle={useDealState ? dealTitle(useDealState.row) : ""}
        businessName={useDealState ? businessName(useDealState.row) : ""}
        busy={useDealBusy}
        onConfirmSlide={() => void onSlideConfirmed()}
        onClose={() => !useDealBusy && closeUseDealFlow()}
      />

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

      <WalletRedeemModal
        visible={qrVisible}
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
    </View>
  );
}
