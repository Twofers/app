import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Image } from "expo-image";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { format, startOfDay, startOfMonth, subDays } from "date-fns";

import { Banner } from "@/components/ui/banner";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { MerchantInsightsPanel } from "@/components/merchant-insights-panel";
import { Colors, Fonts } from "@/constants/theme";
import { useBusiness } from "@/hooks/use-business";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useTabMode } from "@/lib/tab-mode";
import {
  DEFAULT_CLAIM_GRACE_MINUTES,
  isPastClaimRedeemDeadline,
} from "@/lib/claim-redeem-deadline";
import { formatValiditySummary } from "@/lib/deal-time";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { parseMerchantInsights, type MerchantInsightsRow } from "@/lib/merchant-insights";
import { supabase } from "@/lib/supabase";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { triggerLightHaptic } from "@/lib/press-feedback";
import { printDealFlyer } from "@/lib/deal-flyer";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function EndEarlyButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const rStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        triggerLightHaptic();
        scale.value = withSpring(0.97, { damping: 18 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 18 });
      }}
      style={[
        {
          minHeight: 48,
          borderRadius: 20,
          borderWidth: 2,
          borderColor: "rgba(198,40,40,0.85)",
          backgroundColor: "#fff",
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.65 : 1,
        },
        rStyle,
      ]}
    >
      <Text
        style={{
          color: "#b71c1c",
          fontWeight: "800",
          fontSize: 15,
          ...(Fonts.sans ? { fontFamily: Fonts.sans } : {}),
        }}
      >
        {title}
      </Text>
    </AnimatedPressable>
  );
}

type ClaimRow = {
  deal_id: string;
  user_id: string;
  created_at: string;
  redeemed_at: string | null;
  expires_at: string;
  grace_period_minutes: number | null;
};

type DealRow = {
  id: string;
  title: string | null;
  description: string | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  created_at: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
  claims: number;
  redeems: number;
  expiredUnredeemed: number;
  conversion: number;
};

function premiumCardStyle(extra?: object) {
  return {
    backgroundColor: Colors.light.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.light.border,
    boxShadow: "0px 4px 12px rgba(0,0,0,0.08)",
    elevation: 4,
    ...extra,
  };
}

function WeeklyClaimsChart({
  labels,
  values,
  primary,
}: {
  labels: string[];
  values: number[];
  primary: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 120, gap: 5 }}>
      {values.map((v, i) => {
        const h = Math.max(8, Math.round((v / max) * 92));
        return (
          <View key={`${labels[i]}-${i}`} style={{ flex: 1, alignItems: "center" }}>
            <View
              style={{
                width: "100%",
                height: h,
                backgroundColor: primary,
                borderRadius: 10,
                opacity: v === 0 ? 0.28 : 0.92,
              }}
            />
            <Text
              style={{
                marginTop: Spacing.sm,
                fontSize: 11,
                fontWeight: "700",
                color: Colors.light.text,
                opacity: 0.45,
              }}
            >
              {labels[i]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function MetricTile({
  label,
  value,
  sublabel,
  delay,
  fullWidth,
}: {
  label: string;
  value: string;
  sublabel?: string;
  delay: number;
  fullWidth?: boolean;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(420).delay(delay).springify()}
      style={[
        { flexBasis: fullWidth ? "100%" : "47%", flexGrow: 1, padding: Spacing.lg },
        premiumCardStyle(),
      ]}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "700",
          color: Colors.light.text,
          opacity: 0.48,
          letterSpacing: 0.2,
        }}
        numberOfLines={2}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: 26,
          fontWeight: "800",
          marginTop: Spacing.sm,
          color: Colors.light.text,
          letterSpacing: -0.6,
        }}
      >
        {value}
      </Text>
      {sublabel ? (
        <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.5, fontWeight: "600" }}>{sublabel}</Text>
      ) : null}
    </Animated.View>
  );
}

export default function BusinessDashboard() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { mode, ready: modeReady } = useTabMode();
  const { isLoggedIn, businessId, businessName, loading } = useBusiness();

  const [banner, setBanner] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [endingDealId, setEndingDealId] = useState<string | null>(null);
  const [generatingFlyerId, setGeneratingFlyerId] = useState<string | null>(null);
  const [insights, setInsights] = useState<MerchantInsightsRow | null>(null);

  const [dealsLaunchedMonth, setDealsLaunchedMonth] = useState(0);
  const [monthClaims, setMonthClaims] = useState(0);
  const [monthRedeems, setMonthRedeems] = useState(0);
  const [uniqueRedeemers, setUniqueRedeemers] = useState(0);
  const [monthRedemptionPct, setMonthRedemptionPct] = useState(0);
  const [monthViews, setMonthViews] = useState(0);
  const [weekLabels, setWeekLabels] = useState<string[]>([]);
  const [weekCounts, setWeekCounts] = useState<number[]>([]);

  const primary = Colors.light.primary;

  const loadMetrics = useCallback(async () => {
    if (!businessId) return;
    setLoadingMetrics(true);
    setBanner(null);
    const now = new Date();
    const monthStart = startOfMonth(now);
    const weekStart = startOfDay(subDays(now, 6));
    const fetchLower =
      weekStart.getTime() < monthStart.getTime()
        ? weekStart
        : monthStart;

    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = startOfDay(subDays(now, 6 - i));
      return { key: format(d, "yyyy-MM-dd"), label: format(d, "EEE") };
    });
    setWeekLabels(weekDays.map((w) => w.label));

    try {
      const { data: dealsData, error: dealsError } = await supabase
        .from("deals")
        .select(
          "id,title,description,poster_url,poster_storage_path,created_at,start_time,end_time,is_active,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone",
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (dealsError) throw dealsError;

      const launched = (dealsData ?? []).filter(
        (d) => new Date((d as { created_at: string }).created_at).getTime() >= monthStart.getTime(),
      ).length;
      setDealsLaunchedMonth(launched);

      const dealIds = (dealsData ?? []).map((d) => d.id);
      if (dealIds.length === 0) {
        setDeals([]);
        setMonthClaims(0);
        setMonthRedeems(0);
        setUniqueRedeemers(0);
        setMonthRedemptionPct(0);
        setMonthViews(0);
        setWeekCounts(weekDays.map(() => 0));
        setInsights(null);
        setLoadingMetrics(false);
        return;
      }

      const { data: claimsRaw, error: claimsError } = await supabase
        .from("deal_claims")
        .select(
          "deal_id,user_id,created_at,redeemed_at,expires_at,grace_period_minutes",
        )
        .in("deal_id", dealIds)
        .gte("created_at", fetchLower.toISOString());
      if (claimsError) throw claimsError;

      const claims = (claimsRaw ?? []) as ClaimRow[];
      const nowMs = Date.now();
      const weekKeyToCount: Record<string, number> = Object.fromEntries(
        weekDays.map((w) => [w.key, 0]),
      );

      claims.forEach((c) => {
        const dayKey = format(new Date(c.created_at), "yyyy-MM-dd");
        if (dayKey in weekKeyToCount) {
          weekKeyToCount[dayKey] += 1;
        }
      });
      setWeekCounts(weekDays.map((w) => weekKeyToCount[w.key] ?? 0));

      const monthMs = monthStart.getTime();
      const monthOnly = claims.filter((c) => new Date(c.created_at).getTime() >= monthMs);
      const claimCount = monthOnly.length;
      const redeemCount = monthOnly.filter((c) => c.redeemed_at).length;
      const redeemers = new Set(
        monthOnly.filter((c) => c.redeemed_at).map((c) => c.user_id),
      );

      setMonthClaims(claimCount);
      setMonthRedeems(redeemCount);
      setUniqueRedeemers(redeemers.size);
      setMonthRedemptionPct(
        claimCount > 0 ? Math.round((redeemCount / claimCount) * 100) : 0,
      );

      const perDealMap: Record<
        string,
        { claims: number; redeems: number; expiredUnredeemed: number }
      > = {};
      monthOnly.forEach((c) => {
        if (!perDealMap[c.deal_id]) {
          perDealMap[c.deal_id] = { claims: 0, redeems: 0, expiredUnredeemed: 0 };
        }
        perDealMap[c.deal_id].claims += 1;
        if (c.redeemed_at) {
          perDealMap[c.deal_id].redeems += 1;
        } else {
          const g = c.grace_period_minutes ?? DEFAULT_CLAIM_GRACE_MINUTES;
          if (isPastClaimRedeemDeadline(c.expires_at, nowMs, g)) {
            perDealMap[c.deal_id].expiredUnredeemed += 1;
          }
        }
      });

      const hydrated: DealRow[] = (dealsData ?? []).map(
        (
          deal: Omit<DealRow, "claims" | "redeems" | "expiredUnredeemed" | "conversion">,
        ) => {
          const metrics = perDealMap[deal.id] ?? {
            claims: 0,
            redeems: 0,
            expiredUnredeemed: 0,
          };
          const conversion =
            metrics.claims > 0 ? Math.round((metrics.redeems / metrics.claims) * 100) : 0;
          return {
            ...deal,
            claims: metrics.claims,
            redeems: metrics.redeems,
            expiredUnredeemed: metrics.expiredUnredeemed,
            conversion,
          };
        },
      );

      setDeals(hydrated);

      const { count: viewsCount } = await supabase
        .from("app_analytics_events")
        .select("id", { count: "exact", head: true })
        .in("event_name", ["deal_viewed", "deal_opened"])
        .in("deal_id", dealIds)
        .gte("occurred_at", monthStart.toISOString());
      setMonthViews(viewsCount ?? 0);

      const { data: rpcInsights, error: rpcErr } = await supabase.rpc("merchant_business_insights", {
        p_business_id: businessId,
      });
      if (!rpcErr) {
        setInsights(parseMerchantInsights(rpcInsights));
      } else {
        setInsights(null);
      }
    } catch (err: unknown) {
      setInsights(null);
      const msg = err instanceof Error ? err.message : t("offersDashboard.errLoadDashboard");
      setBanner(msg);
      setWeekCounts(weekDays.map(() => 0));
    } finally {
      setLoadingMetrics(false);
    }
  }, [businessId, t]);

  useEffect(() => {
    if (!businessId) return;
    void loadMetrics();
  }, [businessId, loadMetrics]);

  async function onRefresh() {
    setRefreshing(true);
    await loadMetrics();
    setRefreshing(false);
  }

  function endDealEarly(dealId: string) {
    if (!businessId || endingDealId) return;
    Alert.alert(
      t("offersDashboard.endDealConfirmTitle"),
      t("offersDashboard.endDealConfirmBody"),
      [
        { text: t("commonUi.cancel"), style: "cancel" },
        {
          text: t("offersDashboard.endDealEarly"),
          style: "destructive",
          onPress: () => void doEndDealEarly(dealId),
        },
      ],
    );
  }

  async function doEndDealEarly(dealId: string) {
    setEndingDealId(dealId);
    setBanner(null);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("deals")
        .update({ is_active: false, end_time: nowIso })
        .eq("id", dealId)
        .eq("business_id", businessId);
      if (error) throw error;
      await loadMetrics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("offersDashboard.errEndDeal");
      setBanner(msg);
    } finally {
      setEndingDealId(null);
    }
  }

  async function generateFlyer(deal: DealRow) {
    if (generatingFlyerId) return;
    setGeneratingFlyerId(deal.id);
    setBanner(null);
    try {
      const posterUri = resolveDealPosterDisplayUri(deal.poster_url, deal.poster_storage_path);
      await printDealFlyer({
        dealId: deal.id,
        title: deal.title ?? t("offersDashboard.dealFallback"),
        description: deal.description,
        posterUri,
        businessName: businessName ?? "",
        strings: {
          scanAtCounter: t("offersDashboard.flyerScanAtCounter"),
          openInApp: t("offersDashboard.flyerOpenInApp"),
          poweredBy: t("offersDashboard.flyerPoweredBy"),
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("offersDashboard.errFlyer");
      setBanner(msg);
    } finally {
      setGeneratingFlyerId(null);
    }
  }

  const dealActive = (item: DealRow) =>
    item.is_active && new Date(item.end_time).getTime() > Date.now();

  const listHeader = useMemo(
    () => (
      <View style={{ marginBottom: Spacing.lg }}>
        <Text style={{ fontWeight: "700", marginBottom: Spacing.sm, fontSize: 16, letterSpacing: -0.2 }}>
          {t("offersDashboard.overview")}
        </Text>
        <Text style={{ fontSize: 13, opacity: 0.55, marginBottom: Spacing.lg, lineHeight: 18 }}>
          {t("offersDashboard.periodHint")}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.md, marginBottom: Spacing.md }}>
          <MetricTile
            label={t("offersDashboard.metricViews")}
            value={String(monthViews)}
            delay={20}
          />
          <MetricTile
            label={t("offersDashboard.metricDealsLaunched")}
            value={String(dealsLaunchedMonth)}
            delay={40}
          />
          <MetricTile
            label={t("offersDashboard.metricTotalClaims")}
            value={String(monthClaims)}
            delay={80}
          />
          <MetricTile
            label={t("offersDashboard.metricRedemptions")}
            value={String(monthRedeems)}
            delay={120}
          />
          <MetricTile
            label={t("offersDashboard.metricNewCustomers")}
            value={String(uniqueRedeemers)}
            sublabel={t("offersDashboard.metricNewCustomersSub")}
            delay={160}
          />
          <MetricTile
            label={t("offersDashboard.metricAvgRedemption")}
            value={monthClaims > 0 ? `${monthRedemptionPct}%` : "—"}
            sublabel={t("offersDashboard.metricAvgRedemptionSub")}
            delay={200}
            fullWidth
          />
        </View>

        <Animated.View
          entering={FadeInDown.duration(440).delay(220).springify()}
          style={[{ padding: Spacing.lg, marginBottom: Spacing.lg }, premiumCardStyle()]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.md }}>
            <View
              style={{
                width: 4,
                height: 22,
                borderRadius: 2,
                backgroundColor: primary,
              }}
            />
            <Text style={{ fontWeight: "800", fontSize: 15, color: Colors.light.text, flex: 1 }}>
              {t("offersDashboard.inventorySaved")}
            </Text>
          </View>
          <Text style={{ fontSize: 15, lineHeight: 22, opacity: 0.72, fontWeight: "600" }}>
            {t("offersDashboard.inventoryPlaceholder")}
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(440).delay(260).springify()}
          style={[{ padding: Spacing.lg, marginBottom: Spacing.lg }, premiumCardStyle()]}
        >
          <Text style={{ fontWeight: "800", fontSize: 15, marginBottom: Spacing.sm, color: Colors.light.text }}>
            {t("offersDashboard.chartTitle")}
          </Text>
          <WeeklyClaimsChart labels={weekLabels} values={weekCounts} primary={primary} />
          <Text style={{ marginTop: Spacing.md, fontSize: 12, opacity: 0.5, fontWeight: "600" }}>
            {t("offersDashboard.chartFooter")}
          </Text>
        </Animated.View>

        <MerchantInsightsPanel insights={insights} />

        <Text
          style={{
            fontWeight: "800",
            marginBottom: Spacing.md,
            fontSize: 16,
            letterSpacing: -0.2,
            marginTop: Spacing.sm,
          }}
        >
          {t("offersDashboard.recentDeals")}
        </Text>
      </View>
    ),
    [
      t,
      dealsLaunchedMonth,
      monthClaims,
      monthRedeems,
      uniqueRedeemers,
      monthRedemptionPct,
      primary,
      weekLabels,
      weekCounts,
      insights,
    ],
  );

  if (!modeReady) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={primary} />
      </View>
    );
  }
  if (mode === "customer") {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: Colors.light.background }}>
      <Animated.View entering={FadeInDown.duration(400).springify()}>
        <Text
          style={{
            fontSize: 28,
            fontWeight: "800",
            letterSpacing: -0.6,
            color: Colors.light.text,
          }}
        >
          {t("tabs.dashboard")}
        </Text>
        {businessName ? (
          <Text style={{ marginTop: Spacing.xs, fontSize: 15, opacity: 0.55, fontWeight: "600" }}>
            {t("businessDashboard.welcomeBack")} {businessName}
          </Text>
        ) : null}
        <Text
          style={{
            marginTop: businessName ? Spacing.sm : Spacing.xs,
            opacity: 0.62,
            fontSize: 15,
            marginBottom: Spacing.md,
            lineHeight: 20,
            fontWeight: "500",
          }}
        >
          {t("offersDashboard.subtitle")}
        </Text>
      </Animated.View>

      {!isLoggedIn ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7, fontWeight: "500" }}>
          {t("offersDashboard.loginPrompt")}
        </Text>
      ) : loading ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>{t("offersDashboard.loading")}</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>{t("offersDashboard.needBusiness")}</Text>
      ) : (
        <View style={{ flex: 1, marginTop: Spacing.xs }}>
          {banner ? <Banner message={banner} tone="error" /> : null}

          {loadingMetrics ? (
            <LoadingSkeleton rows={4} />
          ) : (
            <FlatList
              style={{ flex: 1 }}
              data={deals}
              keyExtractor={(item) => item.id}
              ListHeaderComponent={listHeader}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
              ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
              renderItem={({ item }) => {
                const active = dealActive(item);
                const posterUri = resolveDealPosterDisplayUri(item.poster_url, item.poster_storage_path);
                return (
                  <Animated.View entering={FadeInDown.duration(360).delay(60).springify()}>
                    <View style={[{ padding: Spacing.lg, overflow: "hidden" }, premiumCardStyle()]}>
                      <HapticScalePressable
                        onPress={() => router.push(`/deal-analytics/${item.id}`)}
                        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
                      >
                        <View style={{ flexDirection: "row", gap: Spacing.md }}>
                          {posterUri ? (
                            <Image
                              source={{ uri: posterUri }}
                              style={{ height: 88, width: 88, borderRadius: 16 }}
                              contentFit="cover"
                            />
                          ) : (
                            <View
                              style={{
                                height: 88,
                                width: 88,
                                borderRadius: 16,
                                backgroundColor: "#f3f4f6",
                              }}
                            />
                          )}
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
                              <Text style={{ fontWeight: "800", fontSize: 17, flex: 1 }} numberOfLines={2}>
                                {item.title ?? t("offersDashboard.dealFallback")}
                              </Text>
                              <View
                                style={{
                                  paddingHorizontal: Spacing.sm,
                                  paddingVertical: 4,
                                  borderRadius: 999,
                                  backgroundColor: active ? "rgba(255,159,28,0.16)" : "#f0f0f0",
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 11,
                                    fontWeight: "800",
                                    color: active ? "#c26100" : "#555",
                                  }}
                                >
                                  {active ? t("commonUi.live") : t("commonUi.ended")}
                                </Text>
                              </View>
                            </View>
                            <Text
                              style={{ opacity: 0.58, marginTop: Spacing.xs, fontSize: 13, fontWeight: "600" }}
                              numberOfLines={2}
                            >
                              {formatValiditySummary(item, {
                                lang: i18n.language,
                                endsVerb: t("commonUi.dealEndsVerb"),
                                t,
                              })}
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                flexWrap: "wrap",
                                gap: Spacing.sm,
                                marginTop: Spacing.md,
                              }}
                            >
                              <Text style={{ fontSize: 12, opacity: 0.62, fontWeight: "600" }}>
                                {t("offersDashboard.rowClaims", { count: item.claims })}
                              </Text>
                              <Text style={{ fontSize: 12, opacity: 0.62, fontWeight: "600" }}>
                                · {t("offersDashboard.rowRedeems", { count: item.redeems })}
                              </Text>
                              <Text style={{ fontSize: 12, opacity: 0.62, fontWeight: "600" }}>
                                · {t("offersDashboard.rowExpired", { count: item.expiredUnredeemed })}
                              </Text>
                              <Text style={{ fontSize: 12, opacity: 0.62, fontWeight: "600" }}>
                                · {t("offersDashboard.rowConv", { pct: item.conversion })}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </HapticScalePressable>

                      <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
                        {active ? (
                          endingDealId === item.id ? (
                            <View
                              style={{
                                minHeight: 48,
                                borderRadius: 20,
                                borderWidth: 2,
                                borderColor: "rgba(198,40,40,0.35)",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <ActivityIndicator color="#c62828" />
                            </View>
                          ) : (
                            <EndEarlyButton
                              title={t("offersDashboard.endDealEarly")}
                              onPress={() => endDealEarly(item.id)}
                            />
                          )
                        ) : null}

                        <HapticScalePressable
                          onPress={() => generateFlyer(item)}
                          disabled={generatingFlyerId === item.id}
                          style={{
                            minHeight: 48,
                            borderRadius: 20,
                            borderWidth: 2,
                            borderColor: Colors.light.primary,
                            backgroundColor: "#fff",
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: generatingFlyerId === item.id ? 0.6 : 1,
                          }}
                        >
                          {generatingFlyerId === item.id ? (
                            <ActivityIndicator color={Colors.light.primary} />
                          ) : (
                            <Text
                              style={{
                                color: Colors.light.primary,
                                fontWeight: "800",
                                fontSize: 15,
                                ...(Fonts.sans ? { fontFamily: Fonts.sans } : {}),
                              }}
                            >
                              {t("offersDashboard.printFlyer")}
                            </Text>
                          )}
                        </HapticScalePressable>
                      </View>
                    </View>
                  </Animated.View>
                );
              }}
              ListEmptyComponent={
                <View style={{ gap: Spacing.md }}>
                  <Text style={{ opacity: 0.68, fontSize: 15, fontWeight: "500" }}>
                    {t("offersDashboard.emptyDeals")}
                  </Text>
                  <HapticScalePressable
                    onPress={() => router.push("/create/quick")}
                    style={{
                      borderRadius: 16,
                      padding: Spacing.lg,
                      backgroundColor: primary,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
                      {t("offersDashboard.createFirstDeal")}
                    </Text>
                  </HapticScalePressable>
                </View>
              }
            />
          )}
        </View>
      )}
    </View>
  );
}
