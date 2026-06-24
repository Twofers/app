import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Redirect, useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Image } from "expo-image";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { format, startOfDay, startOfMonth, subDays } from "date-fns";

import { AppErrorBoundary } from "@/components/app-error-boundary";
import { devWarn } from "@/lib/dev-log";
import { Banner } from "@/components/ui/banner";
import { CardShell } from "@/components/ui/card-shell";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { MerchantInsightsPanel } from "@/components/merchant-insights-panel";
import { PrimaryButton } from "@/components/ui/primary-button";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Controls, Fonts, Gray, PrimaryTint, Radii } from "@/constants/theme";
import { PAID_BILLING_ENABLED } from "@/lib/billing/access";
import { useBusiness } from "@/hooks/use-business";
import { usePrimaryLocationBillingGate } from "@/hooks/use-primary-location-billing-gate";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useTabMode } from "@/lib/tab-mode";
import {
  DEFAULT_CLAIM_GRACE_MINUTES,
  isPastClaimRedeemDeadline,
} from "@/lib/claim-redeem-deadline";
import {
  formatValiditySummary,
  getMerchantDealScheduleStatus,
  type MerchantDealScheduleStatus,
} from "@/lib/deal-time";
import { getDealDisplayTitle } from "@/lib/deal-display-copy";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { buildReuseDealPrefillParams } from "@/lib/reuse-deal-prefill";
import { parseMerchantInsights, type MerchantInsightsRow } from "@/lib/merchant-insights";
import { supabase } from "@/lib/supabase";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { triggerLightHaptic } from "@/lib/press-feedback";
import { printDealFlyer } from "@/lib/deal-flyer";
import { exportAnalyticsCsv, exportAnalyticsPdf, type ExportRow } from "@/lib/analytics-export";
import { WelcomeWalkthrough } from "@/components/welcome-walkthrough";
import { AiInsightsCard } from "@/components/ai-insights-card";
import { consumeRecentPublish } from "@/lib/recent-publish";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DemoOfferNotice } from "@/components/demo-offer-notice";

function friendlyDashboardError(err: unknown, fallback: string): string {
  devWarn("[dashboard]", err);
  return fallback;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function DealListSeparator() {
  return <View style={{ height: Spacing.md }} />;
}

function EndEarlyButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
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
          minHeight: Controls.buttonHeight,
          borderRadius: Radii.md,
          borderWidth: 2,
          borderColor: theme.danger,
          backgroundColor: theme.surface,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.65 : 1,
        },
        rStyle,
      ]}
    >
      <Text
        style={{
          color: theme.danger,
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
  source_locale: string | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  created_at: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  is_demo?: boolean | null;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
  price: number | null;
  max_claims: number | null;
  claim_cutoff_buffer_minutes: number | null;
  deal_type?: string | null;
  discount_percent?: number | null;
  item_description?: string | null;
  item_retail_value_cents?: number | null;
  required_item_description?: string | null;
  required_item_retail_value_cents?: number | null;
  free_item_description?: string | null;
  free_item_retail_value_cents?: number | null;
  claims: number;
  redeems: number;
  expiredUnredeemed: number;
  conversion: number;
};

type PerDealMetrics = {
  claims: number;
  redeems: number;
  expiredUnredeemed: number;
};

const DASHBOARD_DEALS_PAGE_SIZE = 100;
const DASHBOARD_DEALS_BASE_SELECT =
  "id,title,description,source_locale,poster_url,poster_storage_path,created_at,start_time,end_time,is_active,is_demo,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone,price,max_claims,claim_cutoff_buffer_minutes";
const DASHBOARD_DEALS_ENRICHED_SELECT =
  `${DASHBOARD_DEALS_BASE_SELECT},deal_type,discount_percent,item_description,item_retail_value_cents,required_item_description,required_item_retail_value_cents,free_item_description,free_item_retail_value_cents`;
const OPTIONAL_DASHBOARD_DEAL_COLUMNS = [
  "deal_type",
  "discount_percent",
  "item_description",
  "item_retail_value_cents",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_description",
  "free_item_retail_value_cents",
] as const;

function isMissingOptionalDashboardDealColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST204" || error?.code === "42703" || message.toLowerCase().includes("schema cache")) &&
    OPTIONAL_DASHBOARD_DEAL_COLUMNS.some((column) => message.includes(column))
  );
}

async function fetchDashboardDealsPage(businessId: string, from: number, to: number) {
  const enriched = await supabase
    .from("deals")
    .select(DASHBOARD_DEALS_ENRICHED_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (!isMissingOptionalDashboardDealColumn(enriched.error)) return enriched;

  return supabase
    .from("deals")
    .select(DASHBOARD_DEALS_BASE_SELECT)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
}

function buildPerDealMap(monthOnly: ClaimRow[], nowMs: number): Record<string, PerDealMetrics> {
  const perDealMap: Record<string, PerDealMetrics> = {};
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
  return perDealMap;
}

function hydrateDealRows(
  dealsData: Omit<DealRow, "claims" | "redeems" | "expiredUnredeemed" | "conversion">[],
  perDealMap: Record<string, PerDealMetrics>,
): DealRow[] {
  return dealsData.map((deal) => {
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
  });
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
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
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
                color: theme.text,
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
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  return (
    <Animated.View
      entering={FadeInDown.duration(420).delay(delay).springify()}
      style={[{ flexBasis: fullWidth ? "100%" : "47%", flexGrow: 1 }]}
    >
      <CardShell style={{ flex: 1 }}>
      <Text
        style={{
          fontSize: 12,
          fontWeight: "700",
          color: theme.text,
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
          color: theme.text,
          letterSpacing: -0.6,
        }}
      >
        {value}
      </Text>
      {sublabel ? (
        <Text style={{ marginTop: 6, fontSize: 12, opacity: 0.5, fontWeight: "600", color: theme.text }}>{sublabel}</Text>
      ) : null}
      </CardShell>
    </Animated.View>
  );
}

function SnapshotMetric({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: boolean;
}) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  return (
    <View
      style={{
        flexBasis: "47%",
        flexGrow: 1,
        minWidth: 0,
        minHeight: 86,
        borderRadius: Radii.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
        paddingHorizontal: 10,
        paddingVertical: Spacing.md,
        justifyContent: "center",
      }}
    >
      <Text
        style={{ fontSize: 12, lineHeight: 15, fontWeight: "800", color: theme.mutedText }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.68}
        maxFontSizeMultiplier={1.15}
      >
        {label}
      </Text>
      <Text
        style={{
          marginTop: 4,
          fontSize: 24,
          fontWeight: "900",
          color: accent ? theme.accentText : theme.text,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        maxFontSizeMultiplier={1.2}
      >
        {value}
      </Text>
      {sublabel ? (
        <Text
          style={{ marginTop: 4, fontSize: 12, lineHeight: 15, fontWeight: "600", color: theme.mutedText }}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.74}
          maxFontSizeMultiplier={1.15}
        >
          {sublabel}
        </Text>
      ) : null}
    </View>
  );
}

function DealStatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: "30%",
        minWidth: 86,
        borderRadius: Radii.pill,
        backgroundColor: accent
          ? colorScheme === "dark"
            ? "rgba(255,159,28,0.18)"
            : "rgba(255,159,28,0.14)"
          : theme.surfaceMuted,
        borderWidth: 1,
        borderColor: accent ? "rgba(255,159,28,0.34)" : theme.border,
        paddingHorizontal: Spacing.md,
        paddingVertical: 8,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "800", color: theme.mutedText }} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={{
          marginTop: 2,
          fontSize: 15,
          fontWeight: "900",
          color: accent ? theme.accentText : theme.text,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
      </Text>
    </View>
  );
}

function ScrollFilterRow({
  items,
  selected,
  onSelect,
  activeTone = "primary",
}: {
  items: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
  activeTone?: "primary" | "subtle";
}) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: Spacing.xs, alignItems: "center" }}
    >
      {items.map((item) => {
        const active = item.key === selected;
        const primaryActive = active && activeTone === "primary";
        const subtleActive = active && activeTone === "subtle";
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={{
              paddingHorizontal: Spacing.md,
              paddingVertical: 6,
              borderRadius: Radii.pill,
              borderWidth: subtleActive ? 1 : 0,
              borderColor: subtleActive ? theme.primary : "transparent",
              backgroundColor: primaryActive ? theme.primary : theme.surfaceMuted,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: active ? "800" : "600",
                color: primaryActive ? theme.primaryText : subtleActive ? theme.accentText : colorScheme === "dark" ? theme.text : Gray[700],
              }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
              maxFontSizeMultiplier={1.15}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function BusinessDashboard() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { mode, ready: modeReady } = useTabMode();
  const { isLoggedIn, businessId, businessName, businessProfile, loading, subscriptionTier } = useBusiness();
  const { confirm, confirmModal } = useBrandedConfirm();

  const [banner, setBanner] = useState<string | null>(null);
  const [publishSuccessBanner, setPublishSuccessBanner] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [endingDealId, setEndingDealId] = useState<string | null>(null);
  const [pausingDealId, setPausingDealId] = useState<string | null>(null);
  const [deletingDealId, setDeletingDealId] = useState<string | null>(null);
  const [generatingFlyerId, setGeneratingFlyerId] = useState<string | null>(null);
  const [insights, setInsights] = useState<MerchantInsightsRow | null>(null);
  const [dealsHasMore, setDealsHasMore] = useState(false);
  const [dealsLoadingMore, setDealsLoadingMore] = useState(false);
  const perDealMetricsRef = useRef<Record<string, PerDealMetrics>>({});

  const [dealsLaunchedMonth, setDealsLaunchedMonth] = useState(0);
  const [monthClaims, setMonthClaims] = useState(0);
  const [monthRedeems, setMonthRedeems] = useState(0);
  const [uniqueRedeemers, setUniqueRedeemers] = useState(0);
  const [monthRedemptionPct, setMonthRedemptionPct] = useState(0);
  const [monthImpressions, setMonthImpressions] = useState(0);
  const [monthOpens, setMonthOpens] = useState(0);
  const [weekLabels, setWeekLabels] = useState<string[]>([]);
  const [weekCounts, setWeekCounts] = useState<number[]>([]);
  const [monthlyStatsOpen, setMonthlyStatsOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [dealManageFor, setDealManageFor] = useState<DealRow | null>(null);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [dealFilter, setDealFilter] = useState<"all" | "live" | "ended" | "recurring">("all");
  const [dealSort, setDealSort] = useState<"newest" | "claims" | "conversion">("newest");
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exportingAnalytics, setExportingAnalytics] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const primary = theme.primary;

  const {
    blocked: billingGateBlocked,
    loading: billingGateLoading,
  } = usePrimaryLocationBillingGate({
    businessId,
    subscriptionTier,
    isLoggedIn,
  });

  const billingBlocked = Boolean(
    PAID_BILLING_ENABLED &&
      businessId &&
      !billingGateLoading &&
      billingGateBlocked,
  );

  const loadMetrics = useCallback(async () => {
    if (!businessId) return false;
    setLoadingMetrics(true);
    setBanner(null);
    setDealsHasMore(false);
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
      const { count: launchedCount, error: launchedErr } = await supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gte("created_at", monthStart.toISOString());
      if (launchedErr) throw launchedErr;
      setDealsLaunchedMonth(launchedCount ?? 0);

      const { data: claimsRaw, error: claimsError } = await supabase
        .from("deal_claims")
        .select(
          "deal_id,user_id,created_at,redeemed_at,expires_at,grace_period_minutes, deals!inner(business_id)",
        )
        .eq("deals.business_id", businessId)
        .gte("created_at", fetchLower.toISOString());
      if (claimsError) throw claimsError;

      const claims = (claimsRaw ?? []) as unknown as ClaimRow[];
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

      const perDealMap = buildPerDealMap(monthOnly, nowMs);
      perDealMetricsRef.current = perDealMap;

      const { data: dealsData, error: dealsError } = await fetchDashboardDealsPage(
        businessId,
        0,
        DASHBOARD_DEALS_PAGE_SIZE - 1,
      );
      if (dealsError) throw dealsError;

      const firstPage = (dealsData ?? []) as Omit<
        DealRow,
        "claims" | "redeems" | "expiredUnredeemed" | "conversion"
      >[];
      setDeals(hydrateDealRows(firstPage, perDealMap));
      setDealsHasMore(firstPage.length === DASHBOARD_DEALS_PAGE_SIZE);

      const { count: impressionsCount } = await supabase
        .from("app_analytics_events")
        .select("id, deals!inner(business_id)", { count: "exact", head: true })
        .eq("event_name", "deal_viewed")
        .eq("deals.business_id", businessId)
        .gte("occurred_at", monthStart.toISOString());

      const { count: opensCount } = await supabase
        .from("app_analytics_events")
        .select("id, deals!inner(business_id)", { count: "exact", head: true })
        .eq("event_name", "deal_opened")
        .eq("deals.business_id", businessId)
        .gte("occurred_at", monthStart.toISOString());

      setMonthImpressions(impressionsCount ?? 0);
      setMonthOpens(opensCount ?? 0);

      const { data: rpcInsights, error: rpcErr } = await supabase.rpc("merchant_business_insights", {
        p_business_id: businessId,
      });
      if (!rpcErr) {
        setInsights(parseMerchantInsights(rpcInsights));
      } else {
        setInsights(null);
      }
      setLastUpdatedAt(new Date());
      return true;
    } catch (err: unknown) {
      setInsights(null);
      setDealsHasMore(false);
      const msg = friendlyDashboardError(err, t("offersDashboard.errLoadDashboard"));
      setBanner(msg);
      setWeekCounts(weekDays.map(() => 0));
      return false;
    } finally {
      setLoadingMetrics(false);
    }
  }, [businessId, t]);

  const loadMoreDeals = useCallback(async () => {
    if (!businessId || !dealsHasMore || dealsLoadingMore || loadingMetrics) return;
    setDealsLoadingMore(true);
    setBanner(null);
    try {
      const offset = deals.length;
      const { data: dealsData, error: dealsError } = await fetchDashboardDealsPage(
        businessId,
        offset,
        offset + DASHBOARD_DEALS_PAGE_SIZE - 1,
      );
      if (dealsError) throw dealsError;
      const chunk = (dealsData ?? []) as Omit<
        DealRow,
        "claims" | "redeems" | "expiredUnredeemed" | "conversion"
      >[];
      const map = perDealMetricsRef.current;
      setDeals((prev) => [...prev, ...hydrateDealRows(chunk, map)]);
      setDealsHasMore(chunk.length === DASHBOARD_DEALS_PAGE_SIZE);
    } catch (err: unknown) {
      const msg = friendlyDashboardError(err, t("offersDashboard.errLoadDashboard"));
      setBanner(msg);
    } finally {
      setDealsLoadingMore(false);
    }
  }, [businessId, deals.length, dealsHasMore, dealsLoadingMore, loadingMetrics, t]);

  useFocusEffect(
    useCallback(() => {
      if (!businessId) return;
      let cancelled = false;
      setPublishSuccessBanner(null);
      void (async () => {
        const metricsLoaded = await loadMetrics();
        const title = await consumeRecentPublish();
        if (!cancelled && metricsLoaded && title) {
          setPublishSuccessBanner(t("offersDashboard.publishSuccessBanner", { title }));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [businessId, loadMetrics, t]),
  );

  // Show walkthrough for first-time business owners
  const WALKTHROUGH_KEY = "twoforone_walkthrough_complete";
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      const done = await AsyncStorage.getItem(WALKTHROUGH_KEY);
      if (!cancelled && !done) {
        setShowWalkthrough(true);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const dismissWalkthrough = useCallback(async () => {
    setShowWalkthrough(false);
    await AsyncStorage.setItem(WALKTHROUGH_KEY, "1");
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    setPublishSuccessBanner(null);
    await loadMetrics();
    setRefreshing(false);
  }

  function endDealEarly(dealId: string) {
    if (!businessId || endingDealId) return;
    confirm({
      iconName: "stop-circle",
      title: t("offersDashboard.endDealConfirmTitle"),
      message: t("offersDashboard.endDealConfirmBody"),
      confirmLabel: t("offersDashboard.endDealEarly"),
      onConfirm: () => void doEndDealEarly(dealId),
      cancelLabel: t("commonUi.cancel"),
    });
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
      const msg = friendlyDashboardError(err, t("offersDashboard.errEndDeal"));
      setBanner(msg);
    } finally {
      setEndingDealId(null);
    }
  }

  function pauseDeal(dealId: string) {
    if (!businessId || pausingDealId) return;
    confirm({
      iconName: "pause-circle-filled",
      title: t("offersDashboard.pauseConfirmTitle", "Pause this deal?"),
      message: t("offersDashboard.pauseConfirmBody", "The deal will be hidden from customers but can be resumed later."),
      confirmLabel: t("offersDashboard.pauseDeal", "Pause"),
      onConfirm: () => void doPauseDeal(dealId),
      cancelLabel: t("commonUi.cancel"),
    });
  }

  async function doPauseDeal(dealId: string) {
    setPausingDealId(dealId);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("deals")
        .update({ is_active: false })
        .eq("id", dealId)
        .eq("business_id", businessId);
      if (error) throw error;
      await loadMetrics();
    } catch (err: unknown) {
      const msg = friendlyDashboardError(err, t("offersDashboard.errPauseDeal", "Could not pause deal."));
      setBanner(msg);
    } finally {
      setPausingDealId(null);
    }
  }

  function resumeDeal(dealId: string) {
    if (!businessId || pausingDealId) return;
    confirm({
      iconName: "play-circle-filled",
      title: t("offersDashboard.resumeConfirmTitle", "Resume this deal?"),
      message: t("offersDashboard.resumeConfirmBody", "The deal will be visible to customers again."),
      confirmLabel: t("offersDashboard.resumeDeal", "Resume"),
      onConfirm: () => void doResumeDeal(dealId),
      cancelLabel: t("commonUi.cancel"),
    });
  }

  async function doResumeDeal(dealId: string) {
    setPausingDealId(dealId);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("deals")
        .update({ is_active: true })
        .eq("id", dealId)
        .eq("business_id", businessId);
      if (error) throw error;
      await loadMetrics();
    } catch (err: unknown) {
      const msg = friendlyDashboardError(err, t("offersDashboard.errResumeDeal", "Could not resume deal."));
      setBanner(msg);
    } finally {
      setPausingDealId(null);
    }
  }

  function duplicateDeal(deal: DealRow) {
    setDealManageFor(null);
    router.push({
      pathname: "/create/ai",
      params: buildReuseDealPrefillParams(deal, { resetSchedule: true }),
    });
  }

  function toggleDealSelection(dealId: string) {
    setSelectedDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }

  function exitBulkMode() {
    setBulkSelectMode(false);
    setSelectedDealIds(new Set());
  }

  async function bulkPause() {
    if (!businessId || selectedDealIds.size === 0) return;
    setBulkBusy(true);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("deals")
        .update({ is_active: false })
        .in("id", Array.from(selectedDealIds))
        .eq("business_id", businessId);
      if (error) throw error;
      await loadMetrics();
      exitBulkMode();
    } catch (err: unknown) {
      const msg = friendlyDashboardError(err, t("offersDashboard.errBulkPause", "Could not pause some deals."));
      setBanner(msg);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkResume() {
    if (!businessId || selectedDealIds.size === 0) return;
    setBulkBusy(true);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("deals")
        .update({ is_active: true })
        .in("id", Array.from(selectedDealIds))
        .eq("business_id", businessId);
      if (error) throw error;
      await loadMetrics();
      exitBulkMode();
    } catch (err: unknown) {
      const msg = friendlyDashboardError(err, t("offersDashboard.errBulkResume", "Could not resume some deals."));
      setBanner(msg);
    } finally {
      setBulkBusy(false);
    }
  }

  function bulkDelete() {
    if (!businessId || selectedDealIds.size === 0) return;
    const count = selectedDealIds.size;
    confirm({
      iconName: "delete",
      title: t("offersDashboard.bulkDeleteConfirmTitle", { defaultValue: "Delete {{count}} deals?", count }),
      message: t("offersDashboard.bulkDeleteConfirmBody", "This cannot be undone. Active claims can still be redeemed."),
      confirmLabel: t("offersDashboard.bulkDelete", { defaultValue: "Delete ({{count}})", count }),
      onConfirm: () => void doBulkDelete(),
      cancelLabel: t("commonUi.cancel"),
    });
  }

  async function doBulkDelete() {
    setBulkBusy(true);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("deals")
        .delete()
        .in("id", Array.from(selectedDealIds))
        .eq("business_id", businessId);
      if (error) throw error;
      await loadMetrics();
      exitBulkMode();
    } catch (err: unknown) {
      const msg = friendlyDashboardError(err, t("offersDashboard.errBulkDelete", "Could not delete some deals."));
      setBanner(msg);
    } finally {
      setBulkBusy(false);
    }
  }

  function deleteOldDeal(deal: DealRow) {
    if (!businessId || deletingDealId || !canDeleteOldDeal(deal)) return;
    const title = displayDealTitle(deal);
    confirm({
      iconName: "delete",
      title: t("offersDashboard.deleteOldDealConfirmTitle", {
        defaultValue: "Delete old deal?",
      }),
      message: t("offersDashboard.deleteOldDealConfirmBody", {
        defaultValue:
          "This removes {{title}} from My offers and deletes its dashboard history. This cannot be undone.",
        title,
      }),
      confirmLabel: t("offersDashboard.deleteOldDeal", { defaultValue: "Delete old deal" }),
      onConfirm: () => void doDeleteOldDeal(deal.id),
      cancelLabel: t("commonUi.cancel"),
    });
  }

  async function doDeleteOldDeal(dealId: string) {
    if (!businessId) return;
    setDeletingDealId(dealId);
    setBanner(null);
    try {
      const { error } = await supabase
        .from("deals")
        .delete()
        .eq("id", dealId)
        .eq("business_id", businessId)
        .lte("end_time", new Date().toISOString());
      if (error) throw error;
      await loadMetrics();
    } catch (err: unknown) {
      const msg = friendlyDashboardError(
        err,
        t("offersDashboard.errDeleteOldDeal", { defaultValue: "Could not delete this old deal." }),
      );
      setBanner(msg);
    } finally {
      setDeletingDealId(null);
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
        title: getDealDisplayTitle(deal, deal.title) || t("offersDashboard.dealFallback"),
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
      const msg = friendlyDashboardError(err, t("offersDashboard.errFlyer"));
      setBanner(msg);
    } finally {
      setGeneratingFlyerId(null);
    }
  }

  function dealScheduleStatus(item: DealRow): MerchantDealScheduleStatus {
    return getMerchantDealScheduleStatus({
      is_active: item.is_active,
      start_time: item.start_time,
      end_time: item.end_time,
      is_recurring: item.is_recurring,
      days_of_week: item.days_of_week,
      window_start_minutes: item.window_start_minutes,
      window_end_minutes: item.window_end_minutes,
      timezone: item.timezone,
    });
  }

  const displayDealTitle = useCallback((item: DealRow): string => {
    return getDealDisplayTitle(item, item.title) || t("offersDashboard.dealFallback");
  }, [t]);

  function isDealPaused(item: DealRow): boolean {
    return !item.is_active && new Date(item.end_time) > new Date();
  }

  function canDeleteOldDeal(item: DealRow): boolean {
    const endMs = new Date(item.end_time).getTime();
    return dealScheduleStatus(item) === "ended" && Number.isFinite(endMs) && endMs <= Date.now();
  }

  function statusBadgeLabel(status: MerchantDealScheduleStatus, item?: DealRow): string {
    if (item && isDealPaused(item)) return t("offersDashboard.statusPaused", "Paused");
    if (status === "scheduled") return t("offersDashboard.statusScheduled");
    if (status === "live") return t("offersDashboard.statusLive");
    if (status === "recurring_inactive") return t("offersDashboard.statusRecurringOff");
    return t("offersDashboard.statusEnded");
  }

  const filteredDeals = useMemo(() => {
    let result = deals;
    if (dealFilter !== "all") {
      result = result.filter((d) => {
        if (dealFilter === "recurring") return d.is_recurring;
        const status = dealScheduleStatus(d);
        if (dealFilter === "live") return status === "live" || status === "scheduled";
        if (dealFilter === "ended") return status === "ended";
        return true;
      });
    }
    if (dealSort === "claims") {
      result = [...result].sort((a, b) => b.claims - a.claims);
    } else if (dealSort === "conversion") {
      result = [...result].sort((a, b) => b.conversion - a.conversion);
    }
    return result;
  }, [deals, dealFilter, dealSort]);

  const liveDeals = useMemo(
    () => deals.filter((d) => dealScheduleStatus(d) === "live" && !isDealPaused(d)),
    [deals],
  );

  const engagementSnapshot = useMemo(() => {
    if (monthOpens > 0) {
      return {
        value: String(monthOpens),
        sublabel: t("offersDashboard.engagementOpensSub", {
          defaultValue: "Deal opens this month",
        }),
      };
    }
    if (monthClaims > 0) {
      return {
        value: `${monthRedemptionPct}%`,
        sublabel: t("offersDashboard.engagementRedemptionSub", {
          defaultValue: "Claims redeemed this month",
        }),
      };
    }
    return {
      value: t("offersDashboard.engagementWaitingValue", {
        defaultValue: "Waiting",
      }),
      sublabel: t("offersDashboard.engagementWaitingSub", {
        defaultValue: "Shows after customers open or claim a deal",
      }),
    };
  }, [monthClaims, monthOpens, monthRedemptionPct, t]);

  const lastUpdatedLabel = lastUpdatedAt
    ? t("offersDashboard.lastUpdatedAt", {
        defaultValue: "Updated {{time}}",
        time: format(lastUpdatedAt, "h:mm a"),
      })
    : t("offersDashboard.lastUpdatedPending", {
        defaultValue: "Refresh to load latest",
      });

  const dashboardNextActionTitle =
    liveDeals.length > 0
      ? t("offersDashboard.reviewLiveDeal", { defaultValue: "Review live deal" })
      : deals.length === 0
        ? t("offersDashboard.createFirstDeal")
        : t("offersDashboard.createDealCta");

  const handleDashboardNextAction = useCallback(() => {
    const firstLiveDeal = liveDeals[0];
    if (firstLiveDeal) {
      router.push(`/deal-analytics/${firstLiveDeal.id}`);
      return;
    }
    router.push("/create/ai");
  }, [liveDeals, router]);

  const doExportAnalytics = useCallback(async (format: "csv" | "pdf") => {
    setExportingAnalytics(true);
    setBanner(null);
    try {
      const rows: ExportRow[] = filteredDeals.map((d) => ({
        dealTitle: displayDealTitle(d),
        startDate: new Date(d.start_time).toLocaleDateString(),
        endDate: new Date(d.end_time).toLocaleDateString(),
        claims: d.claims,
        redemptions: d.redeems,
        conversionRate: d.conversion,
      }));
      if (format === "csv") {
        await exportAnalyticsCsv(rows, businessName ?? "");
      } else {
        await exportAnalyticsPdf(rows, businessName ?? "");
      }
    } catch (err: unknown) {
      const msg = friendlyDashboardError(err, t("dealAnalytics.errExport", "Could not generate export."));
      setBanner(msg);
    } finally {
      setExportingAnalytics(false);
    }
  }, [businessName, displayDealTitle, filteredDeals, t]);

  const handleExportAnalytics = useCallback(() => {
    if (filteredDeals.length === 0) return;
    Alert.alert(
      t("offersDashboard.exportAllTitle", "Export deal analytics"),
      t("dealAnalytics.exportChoose", "Choose export format"),
      [
        { text: t("commonUi.cancel"), style: "cancel" },
        { text: t("dealAnalytics.exportCsv", "CSV"), onPress: () => void doExportAnalytics("csv") },
        { text: t("dealAnalytics.exportPdf", "PDF"), onPress: () => void doExportAnalytics("pdf") },
      ],
    );
  }, [doExportAnalytics, filteredDeals.length, t]);

  const listTop = useMemo(
    () => (
      <View style={{ marginBottom: Spacing.lg, gap: Spacing.md }}>
        <CardShell>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: Spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "800", color: theme.accentText }}>
                {t("offersDashboard.snapshotEyebrow", { defaultValue: "Merchant snapshot" })}
              </Text>
              <Text style={{ marginTop: 4, fontSize: 21, fontWeight: "900", color: theme.text, letterSpacing: -0.2 }}>
                {liveDeals.length > 0
                  ? liveDeals.length === 1
                    ? t("offersDashboard.snapshotLiveTitleOne", {
                        defaultValue: "1 live deal ready for customers",
                      })
                    : t("offersDashboard.snapshotLiveTitleMany", {
                        defaultValue: "{{count}} live deals ready for customers",
                        count: liveDeals.length,
                      })
                  : t("offersDashboard.snapshotNoLiveTitle", {
                      defaultValue: "No live deal right now",
                    })}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 13, fontWeight: "700", color: theme.mutedText }}>
                {lastUpdatedLabel}
              </Text>
            </View>
            <View
              style={{
                borderRadius: Radii.pill,
                backgroundColor: liveDeals.length > 0 ? "rgba(255,159,28,0.16)" : theme.surfaceMuted,
                borderWidth: 1,
                borderColor: liveDeals.length > 0 ? "rgba(255,159,28,0.36)" : theme.border,
                paddingHorizontal: Spacing.md,
                paddingVertical: 7,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "900",
                  color: liveDeals.length > 0 ? theme.accentText : theme.mutedText,
                }}
              >
                {t("offersDashboard.liveDealCount", {
                  defaultValue: "{{count}} live",
                  count: liveDeals.length,
                })}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.lg }}>
            <SnapshotMetric
              label={t("offersDashboard.metricLiveDeals", { defaultValue: "Live deals" })}
              value={String(liveDeals.length)}
              sublabel={
                deals.length > 0
                  ? t("offersDashboard.metricLiveDealsSub", {
                      defaultValue: "{{count}} total deals",
                      count: deals.length,
                    })
                  : t("offersDashboard.metricLiveDealsEmptySub", {
                      defaultValue: "Create one to start tracking",
                    })
              }
              accent={liveDeals.length > 0}
            />
            <SnapshotMetric
              label={t("offersDashboard.metricClaimsMonth", { defaultValue: "Claims" })}
              value={String(monthClaims)}
              sublabel={t("offersDashboard.metricMonthToDate", { defaultValue: "This month" })}
            />
            <SnapshotMetric
              label={t("offersDashboard.metricRedeemsMonth", { defaultValue: "Redemptions" })}
              value={String(monthRedeems)}
              sublabel={t("offersDashboard.metricMonthToDate", { defaultValue: "This month" })}
            />
            <SnapshotMetric
              label={t("offersDashboard.metricEngagement", { defaultValue: "Engagement" })}
              value={engagementSnapshot.value}
              sublabel={engagementSnapshot.sublabel}
              accent={monthOpens > 0 || monthClaims > 0}
            />
          </View>

          <Text style={{ marginTop: Spacing.md, fontSize: 12, lineHeight: 18, fontWeight: "600", color: theme.mutedText }}>
            {t("offersDashboard.dashboardDataNote", {
              defaultValue: "Claims and redemptions use customer activity. Engagement shows opens when available, otherwise redemption rate after claims.",
            })}
          </Text>

          <PrimaryButton
            title={dashboardNextActionTitle}
            onPress={handleDashboardNextAction}
            style={{ marginTop: Spacing.md }}
          />
        </CardShell>
        {billingBlocked ? (
          <Pressable onPress={() => router.push("/(tabs)/account/billing" as Href)} accessibilityRole="button">
            <CardShell variant="muted">
              <Text style={{ fontWeight: "800", fontSize: 15, color: theme.text }}>
                {t("offersDashboard.billingHintShort")}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 14, opacity: 0.65, fontWeight: "600", color: theme.text }}>
                {t("billing.goToBilling", { defaultValue: "Go to billing" })} →
              </Text>
            </CardShell>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text
            style={{
              fontWeight: "800",
              fontSize: 17,
              letterSpacing: -0.2,
              color: theme.text,
              flex: 1,
            }}
          >
            {deals.length > 0
              ? t("offersDashboard.yourDealsCount", { count: deals.length })
              : t("offersDashboard.yourDeals")}
          </Text>
          {deals.length > 0 ? (
            <Pressable
              onPress={() => {
                if (bulkSelectMode) exitBulkMode();
                else setBulkSelectMode(true);
              }}
            >
              <Text
                style={{ fontSize: 14, fontWeight: "700", color: primary }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.15}
              >
                {bulkSelectMode
                  ? t("offersDashboard.selectDone", "Done")
                  : t("offersDashboard.selectMode", "Select")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {bulkSelectMode && filteredDeals.length > 0 ? (
          <View style={{ flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.xs }}>
            <Pressable
              onPress={() => {
                setSelectedDealIds(new Set(filteredDeals.map((d) => d.id)));
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: primary }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                {t("offersDashboard.selectAll", "Select all")}
              </Text>
            </Pressable>
            {selectedDealIds.size > 0 ? (
              <Pressable onPress={() => setSelectedDealIds(new Set())}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.mutedText }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {t("offersDashboard.deselectAll", "Deselect all")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {deals.length > 0 ? (
          <View style={{ gap: Spacing.xs }}>
            <ScrollFilterRow
              items={[
                { key: "all", label: t("offersDashboard.filterAll") },
                { key: "live", label: t("offersDashboard.filterLive") },
                { key: "ended", label: t("offersDashboard.filterEnded") },
                { key: "recurring", label: t("offersDashboard.filterRecurring") },
              ]}
              selected={dealFilter}
              onSelect={(k) => setDealFilter(k as typeof dealFilter)}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.xs }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: theme.mutedText }}>
                {t("offersDashboard.sortPrefix")}
              </Text>
              <View style={{ flex: 1 }}>
                <ScrollFilterRow
                  items={[
                    { key: "newest", label: t("offersDashboard.sortNewest") },
                    { key: "claims", label: t("offersDashboard.sortClaims") },
                    { key: "conversion", label: t("offersDashboard.sortConversion") },
                  ]}
                  selected={dealSort}
                  onSelect={(k) => setDealSort(k as typeof dealSort)}
                  activeTone="subtle"
                />
              </View>
            </View>
            {dealFilter !== "all" ? (
              <Text style={{ fontSize: 13, color: theme.mutedText }}>
                {t("offersDashboard.showingFiltered", { shown: filteredDeals.length, total: deals.length })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    ),
    [
      t,
      router,
      billingBlocked,
      deals.length,
      dealFilter,
      dealSort,
      bulkSelectMode,
      selectedDealIds.size,
      filteredDeals,
      primary,
      theme,
      liveDeals.length,
      lastUpdatedLabel,
      monthClaims,
      monthRedeems,
      monthOpens,
      engagementSnapshot,
      dashboardNextActionTitle,
      handleDashboardNextAction,
    ],
  );

  const listFooter = useMemo(
    () => (
      <View style={{ marginTop: Spacing.xl, gap: Spacing.md, paddingBottom: Spacing.lg }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", fontSize: 16, letterSpacing: -0.2, color: theme.text }}>
            {t("offersDashboard.overview")}
          </Text>
          {filteredDeals.length > 0 ? (
            <SecondaryButton
              title={exportingAnalytics ? "..." : t("offersDashboard.exportAnalytics", "Export")}
              onPress={handleExportAnalytics}
              disabled={exportingAnalytics}
            />
          ) : null}
        </View>
        <Text style={{ fontSize: 13, opacity: 0.55, lineHeight: 18, color: theme.text }}>{t("offersDashboard.periodHint")}</Text>

        <CardShell variant="muted">
          <Text style={{ fontSize: 15, fontWeight: "600", color: theme.text, opacity: 0.88 }}>
            {t("offersDashboard.monthlyStatsSummary", {
              claims: monthClaims,
              redeems: monthRedeems,
              opens: monthOpens,
            })}
          </Text>
          <Pressable
            onPress={() => setMonthlyStatsOpen((v) => !v)}
            style={{ marginTop: Spacing.sm, paddingVertical: Spacing.xs }}
            accessibilityRole="button"
          >
            <Text style={{ fontWeight: "800", fontSize: 14, color: primary }}>
              {monthlyStatsOpen ? t("offersDashboard.monthlyStatsCollapse") : t("offersDashboard.monthlyStatsExpand")}
            </Text>
          </Pressable>
        </CardShell>

        {monthlyStatsOpen ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.md }}>
            <MetricTile
              label={t("offersDashboard.metricImpressions")}
              value={String(monthImpressions)}
              delay={20}
            />
            <MetricTile
              label={t("offersDashboard.metricDealsLaunched")}
              value={String(dealsLaunchedMonth)}
              delay={80}
            />
            <MetricTile
              label={t("offersDashboard.metricOpens")}
              value={String(monthOpens)}
              delay={40}
            />
            <MetricTile
              label={t("offersDashboard.metricTotalClaims")}
              value={String(monthClaims)}
              delay={120}
            />
            <MetricTile
              label={t("offersDashboard.metricRedemptions")}
              value={String(monthRedeems)}
              delay={160}
            />
            <MetricTile
              label={t("offersDashboard.metricUniqueRedeemers", {
                defaultValue: "Unique redeemers",
              })}
              value={String(uniqueRedeemers)}
              sublabel={t("offersDashboard.metricUniqueRedeemersSub", {
                defaultValue: "Customers with a redeemed claim",
              })}
              delay={200}
            />
            <MetricTile
              label={t("offersDashboard.metricAvgRedemption")}
              value={monthClaims > 0 ? `${monthRedemptionPct}%` : "—"}
              sublabel={t("offersDashboard.metricAvgRedemptionSub")}
              delay={240}
              fullWidth
            />
          </View>
        ) : null}

        {deals.length > 0 && businessId ? (
          <AiInsightsCard
            businessId={businessId}
            businessName={businessName}
            businessCategory={businessProfile?.category ?? null}
            weekCounts={weekCounts}
            dealTitles={deals.slice(0, 5).map((d) => displayDealTitle(d))}
            totalClaims={monthClaims}
            totalRedeems={monthRedeems}
            dealsLaunched={dealsLaunchedMonth}
          />
        ) : null}

        <Animated.View entering={FadeInDown.duration(440).delay(120).springify()}>
          <CardShell variant="muted">
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.md }}>
              <View
                style={{
                  width: 4,
                  height: 22,
                  borderRadius: 2,
                  backgroundColor: primary,
                }}
              />
              <Text style={{ fontWeight: "800", fontSize: 15, color: theme.text, flex: 1 }}>
                {t("offersDashboard.dataCoverageTitle", { defaultValue: "What this dashboard can prove" })}
              </Text>
            </View>
            <Text style={{ fontSize: 15, lineHeight: 22, opacity: 0.72, fontWeight: "600", color: theme.text }}>
              {t("offersDashboard.dataCoverageBody", {
                defaultValue: "Twofer shows live deals, claims, redemptions, and app engagement. Inventory saved, revenue lift, and new-customer attribution need POS or customer-history data, so they are not estimated here.",
              })}
            </Text>
          </CardShell>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(440).delay(160).springify()}>
          <CardShell>
            <Text style={{ fontWeight: "800", fontSize: 15, marginBottom: Spacing.sm, color: theme.text }}>
              {t("offersDashboard.chartTitle")}
            </Text>
            <WeeklyClaimsChart labels={weekLabels} values={weekCounts} primary={primary} />
            <Text style={{ marginTop: Spacing.md, fontSize: 12, opacity: 0.5, fontWeight: "600", color: theme.text }}>
              {t("offersDashboard.chartFooter")}
            </Text>
          </CardShell>
        </Animated.View>

        <CardShell variant="muted">
          <Pressable onPress={() => setInsightsOpen((v) => !v)} accessibilityRole="button">
            <Text style={{ fontWeight: "800", fontSize: 15, color: theme.text }}>
              {insightsOpen ? t("offersDashboard.insightsCollapse") : t("offersDashboard.insightsExpand")}
            </Text>
          </Pressable>
        </CardShell>
        {insightsOpen ? <MerchantInsightsPanel insights={insights} /> : null}

        <Pressable onPress={() => router.push("/create/reuse")} accessibilityRole="button">
          <Text style={{ fontWeight: "800", fontSize: 15, color: primary }}>
            {t("offersDashboard.templatesBrowseLink")} →
          </Text>
        </Pressable>
      </View>
    ),
    [
      t,
      primary,
      theme,
      router,
      monthImpressions,
      monthOpens,
      dealsLaunchedMonth,
      monthClaims,
      monthRedeems,
      uniqueRedeemers,
      monthRedemptionPct,
      weekLabels,
      weekCounts,
      insights,
      monthlyStatsOpen,
      insightsOpen,
      deals,
      businessId,
      businessName,
      businessProfile,
      filteredDeals,
      displayDealTitle,
      handleExportAnalytics,
      exportingAnalytics,
    ],
  );

  if (!modeReady) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
        <LoadingSkeleton rows={2} />
      </View>
    );
  }
  if (mode === "customer") {
    return <Redirect href="/(tabs)" />;
  }

  const dashboardSubtitle = businessName
    ? `${t("businessDashboard.welcomeBack")} ${businessName}\n${t("offersDashboard.subtitle")}`
    : t("offersDashboard.subtitle");

  return (
    <AppErrorBoundary>
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <WelcomeWalkthrough
        visible={showWalkthrough}
        onDismiss={dismissWalkthrough}
        businessCategory={businessProfile?.category ?? null}
        businessName={businessName}
        businessId={businessId}
      />
      <Animated.View entering={FadeInDown.duration(400).springify()}>
        <ScreenHeader title={t("tabs.dashboard")} subtitle={dashboardSubtitle} />
      </Animated.View>

      {!isLoggedIn ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7, fontWeight: "500", color: theme.text }}>
          {t("offersDashboard.loginPrompt")}
        </Text>
      ) : loading ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7, color: theme.text }}>{t("offersDashboard.loading")}</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7, color: theme.text }}>{t("offersDashboard.needBusiness")}</Text>
      ) : (
        <View style={{ flex: 1, marginTop: Spacing.xs }}>
          {banner ? <Banner message={banner} tone="error" onRetry={loadMetrics} /> : null}
          {publishSuccessBanner ? <Banner message={publishSuccessBanner} tone="success" /> : null}

          {loadingMetrics ? (
            <LoadingSkeleton rows={4} />
          ) : (
            <FlatList
              style={{ flex: 1 }}
              data={filteredDeals}
              keyExtractor={(item) => item.id}
              ListHeaderComponent={listTop}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} colors={[theme.primary]} />}
              contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
              onEndReachedThreshold={0.35}
              onEndReached={() => void loadMoreDeals()}
              ListFooterComponent={
                <View>
                  {dealsLoadingMore ? (
                    <View style={{ paddingVertical: Spacing.lg, alignItems: "center" }}>
                      <ActivityIndicator color={primary} />
                    </View>
                  ) : dealsHasMore ? (
                    <SecondaryButton
                      title={t("offersDashboard.loadMoreDeals")}
                      onPress={() => void loadMoreDeals()}
                      style={{ marginTop: Spacing.md, marginBottom: Spacing.sm }}
                    />
                  ) : deals.length > 0 ? (
                    <Text
                      style={{
                        textAlign: "center",
                        fontSize: 13,
                        color: theme.mutedText,
                        marginTop: Spacing.md,
                        marginBottom: Spacing.sm,
                      }}
                    >
                      {t("offersDashboard.showingAllDeals", { count: deals.length })}
                    </Text>
                  ) : null}
                  {listFooter}
                </View>
              }
              maxToRenderPerBatch={8}
              windowSize={5}
              ItemSeparatorComponent={DealListSeparator}
              renderItem={({ item }) => {
                const sched = dealScheduleStatus(item);
                const active = sched === "live";
                const posterUri = resolveDealPosterDisplayUri(item.poster_url, item.poster_storage_path);
                return (
                  <Animated.View entering={FadeInDown.duration(360).delay(60).springify()}>
                    <CardShell
                      style={
                        active
                          ? {
                              borderWidth: 2,
                              borderColor: "rgba(255,159,28,0.56)",
                            }
                          : undefined
                      }
                    >
                      <HapticScalePressable
                        onPress={() => {
                          if (bulkSelectMode) {
                            toggleDealSelection(item.id);
                          } else {
                            router.push(`/deal-analytics/${item.id}`);
                          }
                        }}
                        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
                      >
                        <View style={{ flexDirection: "row", gap: Spacing.md }}>
                          {bulkSelectMode ? (
                            <View style={{ justifyContent: "center" }}>
                              <View
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: 12,
                                  borderWidth: 2,
                                  borderColor: selectedDealIds.has(item.id) ? primary : theme.border,
                                  backgroundColor: selectedDealIds.has(item.id) ? primary : "transparent",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {selectedDealIds.has(item.id) ? (
                                  <Text style={{ color: theme.primaryText, fontSize: 14, fontWeight: "800" }}>✓</Text>
                                ) : null}
                              </View>
                            </View>
                          ) : null}
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
                                backgroundColor: theme.surfaceMuted,
                              }}
                            />
                          )}
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, flexWrap: "wrap" }}>
                                <Text style={{ fontWeight: "800", fontSize: 17, flex: 1, color: theme.text }} numberOfLines={2}>
                                {displayDealTitle(item)}
                              </Text>
                              {item.is_recurring ? (
                                <View
                                  style={{
                                    paddingHorizontal: Spacing.sm,
                                    paddingVertical: 4,
                                    borderRadius: 999,
                                    backgroundColor: colorScheme === "dark" ? theme.surfaceMuted : "rgba(17,17,17,0.08)",
                                  }}
                                >
                                  <Text style={{ fontSize: 10, fontWeight: "800", color: colorScheme === "dark" ? theme.mutedText : Gray[700] }}>
                                    {t("offersDashboard.badgeRecurring")}
                                  </Text>
                                </View>
                              ) : null}
                              <View
                                style={{
                                  paddingHorizontal: Spacing.sm,
                                  paddingVertical: 4,
                                  borderRadius: 999,
                                  backgroundColor: active
                                    ? colorScheme === "dark"
                                      ? "rgba(255,159,28,0.18)"
                                      : PrimaryTint.surfaceStrong
                                    : theme.surfaceMuted,
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 11,
                                    fontWeight: "800",
                                    color: active ? theme.accentText : colorScheme === "dark" ? theme.mutedText : Gray[600],
                                  }}
                                >
                                  {statusBadgeLabel(sched, item)}
                                </Text>
                              </View>
                            </View>
                            {item.is_demo ? (
                              <View style={{ marginTop: Spacing.sm }}>
                                <DemoOfferNotice compact />
                              </View>
                            ) : null}
                            <Text
                              style={{ opacity: 0.58, marginTop: Spacing.xs, fontSize: 13, fontWeight: "600", color: theme.text }}
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
                              <DealStatPill
                                label={t("offersDashboard.dealStatClaims", { defaultValue: "Claims" })}
                                value={String(item.claims)}
                                accent={active}
                              />
                              <DealStatPill
                                label={t("offersDashboard.dealStatRedeems", { defaultValue: "Redeemed" })}
                                value={String(item.redeems)}
                              />
                              <DealStatPill
                                label={t("offersDashboard.dealStatConversion", { defaultValue: "Redeem rate" })}
                                value={
                                  item.claims > 0
                                    ? `${item.conversion}%`
                                    : t("offersDashboard.noClaimsYetShort", { defaultValue: "No claims" })
                                }
                              />
                              <DealStatPill
                                label={t("offersDashboard.dealStatExpired", { defaultValue: "Expired" })}
                                value={String(item.expiredUnredeemed)}
                              />
                            </View>
                          </View>
                        </View>
                      </HapticScalePressable>

                      <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
                        <SecondaryButton
                          title={t("offersDashboard.manageDeal")}
                          onPress={() => setDealManageFor(item)}
                        />
                        {sched === "ended" ? (
                          <PrimaryButton
                            title={t("offersDashboard.runAgainCta")}
                            onPress={() => duplicateDeal(item)}
                          />
                        ) : null}
                        {canDeleteOldDeal(item) ? (
                          deletingDealId === item.id ? (
                            <View style={{ padding: Spacing.md, alignItems: "center" }}>
                              <ActivityIndicator color={theme.danger} />
                            </View>
                          ) : (
                            <EndEarlyButton
                              title={t("offersDashboard.deleteOldDeal", { defaultValue: "Delete old deal" })}
                              onPress={() => deleteOldDeal(item)}
                            />
                          )
                        ) : null}
                      </View>
                    </CardShell>
                  </Animated.View>
                );
              }}
              ListEmptyComponent={
                deals.length === 0 ? (
                  <CardShell>
                    <Text style={{ fontSize: 20, fontWeight: "900", color: theme.text, letterSpacing: -0.2 }}>
                      {t("offersDashboard.emptyFirstDealTitle", {
                        defaultValue: "Launch your first Twofer deal",
                      })}
                    </Text>
                    <Text style={{ marginTop: Spacing.sm, fontSize: 15, lineHeight: 22, fontWeight: "600", color: theme.mutedText }}>
                      {t("offersDashboard.emptyFirstDealBody", {
                        defaultValue: "Create one strong 2-for-1 offer. After customers claim or redeem it, this dashboard will show the real activity.",
                      })}
                    </Text>
                    <View style={{ marginTop: Spacing.md, gap: Spacing.xs }}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: theme.text }}>
                        {t("offersDashboard.emptyNextStep", { defaultValue: "Next step: publish a deal customers can claim today." })}
                      </Text>
                      <Text style={{ fontSize: 12, lineHeight: 18, fontWeight: "600", color: theme.mutedText }}>
                        {t("offersDashboard.emptyMetricsNote", {
                          defaultValue: "Claims, redemptions, and engagement will stay blank until there is customer activity.",
                        })}
                      </Text>
                    </View>
                    <PrimaryButton
                      title={t("offersDashboard.createFirstDeal")}
                      onPress={() => router.push("/create/ai")}
                      style={{ marginTop: Spacing.md }}
                    />
                  </CardShell>
                ) : (
                  <CardShell variant="muted">
                    <Text style={{ fontSize: 17, fontWeight: "900", color: theme.text }}>
                      {t("offersDashboard.noFilteredDealsTitle", { defaultValue: "No deals match this view" })}
                    </Text>
                    <Text style={{ marginTop: Spacing.sm, fontSize: 14, lineHeight: 20, fontWeight: "600", color: theme.mutedText }}>
                      {t("offersDashboard.noFilteredDealsBody", {
                        defaultValue: "Clear filters to see all existing deals and their activity.",
                      })}
                    </Text>
                    <SecondaryButton
                      title={t("offersDashboard.clearFilters", { defaultValue: "Clear filters" })}
                      onPress={() => {
                        setDealFilter("all");
                        setDealSort("newest");
                      }}
                      style={{ marginTop: Spacing.md }}
                    />
                  </CardShell>
                )
              }
            />
          )}
        </View>
      )}

      {bulkSelectMode && selectedDealIds.size > 0 ? (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: theme.background,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            paddingHorizontal: horizontal,
            paddingVertical: Spacing.md,
            paddingBottom: Spacing.xl,
            flexDirection: "row",
            gap: Spacing.sm,
          }}
        >
          {bulkBusy ? (
            <View style={{ flex: 1, alignItems: "center", paddingVertical: Spacing.sm }}>
              <ActivityIndicator color={primary} />
            </View>
          ) : (
            <>
              <Pressable
                onPress={() => void bulkPause()}
                style={{
                  flex: 1,
                  minHeight: Controls.buttonHeight,
                  borderRadius: Radii.md,
                  backgroundColor: primary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{ color: theme.primaryText, fontWeight: "800", fontSize: 14, textAlign: "center" }}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  maxFontSizeMultiplier={1.15}
                >
                  {t("offersDashboard.bulkPause", { defaultValue: "Pause ({{count}})", count: selectedDealIds.size })}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void bulkResume()}
                style={{
                  flex: 1,
                  minHeight: Controls.buttonHeight,
                  borderRadius: Radii.md,
                  backgroundColor: theme.surface,
                  borderWidth: 1.5,
                  borderColor: primary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{ color: primary, fontWeight: "800", fontSize: 14, textAlign: "center" }}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  maxFontSizeMultiplier={1.15}
                >
                  {t("offersDashboard.bulkResume", { defaultValue: "Resume ({{count}})", count: selectedDealIds.size })}
                </Text>
              </Pressable>
              <Pressable
                onPress={bulkDelete}
                style={{
                  flex: 1,
                  minHeight: Controls.buttonHeight,
                  borderRadius: Radii.md,
                  backgroundColor: theme.surface,
                  borderWidth: 1.5,
                  borderColor: theme.danger,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{ color: theme.danger, fontWeight: "800", fontSize: 14, textAlign: "center" }}
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  maxFontSizeMultiplier={1.15}
                >
                  {t("offersDashboard.bulkDelete", { defaultValue: "Delete ({{count}})", count: selectedDealIds.size })}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      <Modal
        visible={dealManageFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setDealManageFor(null)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
            onPress={() => setDealManageFor(null)}
          />
          {dealManageFor ? (
            <View
              style={{
                backgroundColor: theme.background,
                borderTopLeftRadius: Radii.lg,
                borderTopRightRadius: Radii.lg,
                borderWidth: 1,
                borderBottomWidth: 0,
                borderColor: theme.border,
                padding: Spacing.lg,
                paddingBottom: Spacing.xl,
                gap: Spacing.sm,
              }}
            >
              <View
                style={{
                  alignSelf: "center",
                  width: 42,
                  height: 5,
                  borderRadius: Radii.pill,
                  backgroundColor: colorScheme === "dark" ? theme.border : "rgba(17,24,28,0.16)",
                  marginBottom: Spacing.xs,
                }}
              />
              <View
                style={{
                  paddingBottom: Spacing.sm,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                  marginBottom: Spacing.xs,
                }}
              >
                <Text style={{ fontWeight: "900", fontSize: 18, lineHeight: 23, color: theme.text }} numberOfLines={2}>
                  {displayDealTitle(dealManageFor)}
                </Text>
              </View>
              {dealScheduleStatus(dealManageFor) !== "ended" && !isDealPaused(dealManageFor) ? (
                <SecondaryButton
                  title={t("offersDashboard.editDeal")}
                  onPress={() => {
                    const id = dealManageFor.id;
                    setDealManageFor(null);
                    router.push({ pathname: "/create/ai", params: { dealId: id } });
                  }}
                />
              ) : null}
              <SecondaryButton
                title={t("offersDashboard.duplicateDeal", "Duplicate deal")}
                onPress={() => duplicateDeal(dealManageFor)}
              />
              <SecondaryButton
                title={t("offersDashboard.printFlyer")}
                onPress={() => {
                  const d = dealManageFor;
                  setDealManageFor(null);
                  void generateFlyer(d);
                }}
              />
              {isDealPaused(dealManageFor) ? (
                pausingDealId === dealManageFor.id ? (
                  <View style={{ padding: Spacing.md, alignItems: "center" }}>
                    <ActivityIndicator color={primary} />
                  </View>
                ) : (
                  <SecondaryButton
                    title={t("offersDashboard.resumeDeal", "Resume deal")}
                    onPress={() => {
                      const id = dealManageFor.id;
                      setDealManageFor(null);
                      resumeDeal(id);
                    }}
                  />
                )
              ) : dealScheduleStatus(dealManageFor) !== "ended" ? (
                pausingDealId === dealManageFor.id ? (
                  <View style={{ padding: Spacing.md, alignItems: "center" }}>
                    <ActivityIndicator color={primary} />
                  </View>
                ) : (
                  <SecondaryButton
                    title={t("offersDashboard.pauseDeal", "Pause deal")}
                    onPress={() => {
                      const id = dealManageFor.id;
                      setDealManageFor(null);
                      pauseDeal(id);
                    }}
                  />
                )
              ) : null}
              {dealScheduleStatus(dealManageFor) !== "ended" && !isDealPaused(dealManageFor) ? (
                endingDealId === dealManageFor.id ? (
                  <View style={{ padding: Spacing.md, alignItems: "center" }}>
                    <ActivityIndicator color={theme.danger} />
                  </View>
                ) : (
                  <EndEarlyButton
                    title={t("offersDashboard.endDealEarly")}
                    onPress={() => {
                      const id = dealManageFor.id;
                      setDealManageFor(null);
                      endDealEarly(id);
                    }}
                  />
                )
              ) : null}
              {canDeleteOldDeal(dealManageFor) ? (
                deletingDealId === dealManageFor.id ? (
                  <View style={{ padding: Spacing.md, alignItems: "center" }}>
                    <ActivityIndicator color={theme.danger} />
                  </View>
                ) : (
                  <EndEarlyButton
                    title={t("offersDashboard.deleteOldDeal", { defaultValue: "Delete old deal" })}
                    onPress={() => {
                      const deal = dealManageFor;
                      setDealManageFor(null);
                      deleteOldDeal(deal);
                    }}
                  />
                )
              ) : null}
              <SecondaryButton title={t("commonUi.cancel")} onPress={() => setDealManageFor(null)} />
            </View>
          ) : null}
        </View>
      </Modal>
      {confirmModal}
    </View>
    </AppErrorBoundary>
  );
}
