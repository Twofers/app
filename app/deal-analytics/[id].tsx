import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, BackHandler, Platform, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { supabase } from "@/lib/supabase";
import { devWarn } from "@/lib/dev-log";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { MerchantInsightsPanel } from "@/components/merchant-insights-panel";
import { parseMerchantInsights, type MerchantInsightsRow } from "@/lib/merchant-insights";
import { formatValiditySummary } from "@/lib/deal-time";
import { formatAppDateFromDayKey } from "@/lib/i18n/format-datetime";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useLoadingTimeout } from "@/hooks/use-loading-timeout";
import { getDealAnalyticsActivityState } from "@/lib/deal-analytics-state";
import { exportAnalyticsCsv, exportAnalyticsPdf, type ExportRow } from "@/lib/analytics-export";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { getDealDisplayTitle } from "@/lib/deal-display-copy";

const CREATE_DEAL_DAY_KEYS = [
  "daySun",
  "dayMon",
  "dayTue",
  "dayWed",
  "dayThu",
  "dayFri",
  "daySat",
] as const;

type ClaimRow = {
  created_at: string;
  redeemed_at: string | null;
};

type DealRow = {
  id: string;
  title: string | null;
  poster_url: string | null;
  start_time: string;
  end_time: string;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
  deal_type?: string | null;
  discount_percent?: number | null;
  item_description?: string | null;
  required_item_description?: string | null;
  free_item_description?: string | null;
};

function dayKey(dateStr: string) {
  const d = new Date(dateStr);
  return d.toISOString().slice(0, 10);
}

export default function DealAnalyticsDetail() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [bestTime, setBestTime] = useState<string | null>(null);
  const [insights, setInsights] = useState<MerchantInsightsRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const loadTimedOut = useLoadingTimeout(loading, undefined, loadAttempt);

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/dashboard" as Href);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        goBack();
        return true;
      });
      return () => sub.remove();
    }, [goBack]),
  );

  function renderBackAction() {
    const label = t("dealAnalytics.backToOffers", "My offers");
    return (
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel={t("dealAnalytics.backToOffersLabel", "Back to My offers")}
        testID="deal-analytics-back-to-offers"
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{
          minHeight: 44,
          paddingHorizontal: 10,
          flexDirection: "row",
          gap: 4,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: Radii.lg,
          backgroundColor: theme.surfaceMuted,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <MaterialIcons name="arrow-back" size={20} color={theme.text} />
        <Text
          style={{ color: theme.text, fontSize: 13, fontWeight: "800" }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  const loadData = useCallback(async () => {
    setLoadAttempt((value) => value + 1);
    if (!id) {
      setLoading(false);
      setLoadFailed(true);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    setBanner(null);
    try {
      const { data: dealData, error: dealError } = await supabase
        .from("deals")
        .select("id,title,poster_url,start_time,end_time,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone,deal_type,discount_percent,item_description,required_item_description,free_item_description")
        .eq("id", id)
        .single();
      if (dealError) throw dealError;
      setDeal(dealData as DealRow);

      const { data: claimData, error: claimError } = await supabase
        .from("deal_claims")
        .select("created_at,redeemed_at")
        .eq("deal_id", id)
        .order("created_at", { ascending: false });
      if (claimError) throw claimError;
      setClaims((claimData ?? []) as ClaimRow[]);

      const { data: rpcInsights, error: rpcErr } = await supabase.rpc("merchant_deal_insights", {
        p_deal_id: id,
      });
      if (!rpcErr) {
        setInsights(parseMerchantInsights(rpcInsights));
      } else {
        setInsights(null);
      }

      const now = new Date();
      const recent = (claimData ?? []).filter((c) => {
        const createdAt = new Date(c.created_at).getTime();
        return createdAt >= now.getTime() - 14 * 24 * 60 * 60 * 1000;
      });
      if (recent.length < 10) {
        setBestTime(t("dealAnalytics.notEnoughData"));
      } else {
        const buckets: Record<string, number> = {};
        for (const c of recent) {
          const dt = new Date(c.created_at);
          const day = dt.getDay();
          const hour = dt.getHours();
          const bucketStart = Math.floor(hour / 2) * 2;
          const key = `${day}-${bucketStart}`;
          buckets[key] = (buckets[key] || 0) + 1;
        }
        let bestKey: string | null = null;
        let bestCount = -1;
        for (const [key, count] of Object.entries(buckets)) {
          if (count > bestCount) {
            bestCount = count;
            bestKey = key;
          }
        }
        if (bestKey) {
          const [dayStr, hourStr] = bestKey.split("-");
          const day = Number(dayStr);
          const hour = Number(hourStr);
          const dayKey = CREATE_DEAL_DAY_KEYS[day] ?? "daySun";
          const dayName = t(`createDeal.${dayKey}`);
          const startLabel = hour % 12 === 0 ? 12 : hour % 12;
          const endHour = (hour + 2) % 24;
          const endLabel = endHour % 12 === 0 ? 12 : endHour % 12;
          const period = endHour < 12 ? t("dealAnalytics.periodAm") : t("dealAnalytics.periodPm");
          setBestTime(
            t("dealAnalytics.bestTime", {
              day: dayName,
              from: String(startLabel),
              to: String(endLabel),
              period,
            }),
          );
        }
      }
    } catch (err: unknown) {
      devWarn("[deal-analytics] load failed", err);
      setBanner(t("dealAnalytics.errLoad"));
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const claimsByDay = useMemo(() => {
    const map: Record<string, { claims: number; redeems: number }> = {};
    claims.forEach((c) => {
      const key = dayKey(c.created_at);
      if (!map[key]) map[key] = { claims: 0, redeems: 0 };
      map[key].claims += 1;
      if (c.redeemed_at) map[key].redeems += 1;
    });
    return Object.entries(map)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([day, counts]) => ({ day, ...counts }));
  }, [claims]);
  const analyticsActivityState = useMemo(() => getDealAnalyticsActivityState(claims), [claims]);

  function renderOfferLoadRecovery() {
    return (
      <View
        style={{
          paddingTop: top,
          paddingHorizontal: horizontal,
          flex: 1,
          backgroundColor: theme.background,
          justifyContent: "center",
          gap: Spacing.md,
        }}
      >
        <EmptyState
          title={t("dealAnalytics.offerLoadErrorTitle", { defaultValue: "We couldn't load this offer." })}
          message={t("dealAnalytics.offerLoadErrorBody", { defaultValue: "Check your connection and try again." })}
          actionLabel={t("commonUi.tryAgain")}
          onAction={() => void loadData()}
        />
        <SecondaryButton
          title={t("dealAnalytics.backToOffersLabel", "Back to offers")}
          accessibilityLabel={t("dealAnalytics.backToOffersLabel", "Back to offers")}
          onPress={goBack}
        />
      </View>
    );
  }

  if (loading && loadTimedOut) {
    return renderOfferLoadRecovery();
  }

  if (loading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
        <ScreenHeader title={t("dealAnalytics.title")} leftSlot={renderBackAction()} />
        <Text style={{ marginTop: Spacing.md, color: theme.mutedText }}>{t("dealAnalytics.loading")}</Text>
      </View>
    );
  }

  if (loadFailed && !deal) {
    return renderOfferLoadRecovery();
  }

  const hasAnalyticsData = analyticsActivityState.hasTimelineData;
  const exportDisabled = exporting || !analyticsActivityState.canExport;

  function openEditDeal() {
    if (!deal) return;
    router.push({ pathname: "/create/ai", params: { dealId: deal.id } } as Href);
  }

  async function handleExport(format: "csv" | "pdf") {
    if (!deal || !hasAnalyticsData) return;
    setExporting(true);
    try {
      const totalClaims = claims.length;
      const totalRedeems = claims.filter((c) => c.redeemed_at).length;
      const row: ExportRow = {
        dealTitle: getDealDisplayTitle(deal, deal.title) || t("offersDashboard.dealFallback"),
        startDate: new Date(deal.start_time).toLocaleDateString(),
        endDate: new Date(deal.end_time).toLocaleDateString(),
        claims: totalClaims,
        redemptions: totalRedeems,
        conversionRate: totalClaims > 0 ? Math.round((totalRedeems / totalClaims) * 100) : 0,
      };
      if (format === "csv") {
        await exportAnalyticsCsv([row], "");
      } else {
        await exportAnalyticsPdf([row], "");
      }
    } catch {
      setBanner(t("dealAnalytics.errExport", "Could not generate export."));
    } finally {
      setExporting(false);
    }
  }

  const headerSubtitle = deal
    ? `${getDealDisplayTitle(deal, deal.title) || t("offersDashboard.dealFallback")}\n${formatValiditySummary(deal, {
        lang: i18n.language,
        endsVerb: t("commonUi.dealEndsVerb"),
        t,
      })}`
    : undefined;

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={t("dealAnalytics.title")} subtitle={headerSubtitle} leftSlot={renderBackAction()} />
      {deal ? (
        <View style={{ marginTop: Spacing.sm, marginBottom: Spacing.xs, gap: Spacing.xs }}>
          <SecondaryButton
            title={t("offersDashboard.editDeal")}
            onPress={openEditDeal}
          />
          <SecondaryButton
            title={exporting ? t("dealAnalytics.exporting", "Exporting...") : t("dealAnalytics.exportTitle", "Export analytics")}
            disabled={exportDisabled}
            onPress={() => {
              Alert.alert(
                t("dealAnalytics.exportTitle", "Export analytics"),
                t("dealAnalytics.exportChoose", "Choose export format"),
                [
                  { text: t("commonUi.cancel"), style: "cancel" },
                  {
                    text: t("dealAnalytics.exportCsv", "CSV"),
                    onPress: () => void handleExport("csv"),
                  },
                  {
                    text: t("dealAnalytics.exportPdf", "PDF"),
                    onPress: () => void handleExport("pdf"),
                  },
                ],
              );
            }}
          />
          {!hasAnalyticsData ? (
            <Text style={{ color: theme.mutedText, fontSize: 13, lineHeight: 18 }}>
              {t("dealAnalytics.exportEmptyHelp", {
                defaultValue: "Export turns on after this offer has claim or redemption data.",
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {banner ? <Banner message={banner} tone="error" /> : null}
      <ScrollView
        style={{ flex: 1, marginTop: Spacing.sm }}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        <MerchantInsightsPanel insights={insights} />

        <Text style={{ fontWeight: "700", fontSize: 17, marginBottom: Spacing.md, color: theme.text }}>
          {t("dealAnalytics.claimsOverTime")}
        </Text>
        {!hasAnalyticsData ? (
          <View style={{ marginBottom: Spacing.lg, gap: Spacing.md }}>
            <Text style={{ color: theme.text, fontWeight: "800", fontSize: 16 }}>{t("dealAnalytics.noClaims")}</Text>
            <Text style={{ color: theme.mutedText, fontSize: 15, lineHeight: 22 }}>
              {t("dealAnalytics.noClaimsHelp", {
                defaultValue: "Analytics will appear after customers view, claim, or redeem this offer.",
              })}
            </Text>
            <Text style={{ color: theme.mutedText, fontSize: 14, lineHeight: 20 }}>
              {t("dealAnalytics.emptyNextStep", {
                defaultValue: "You can edit the deal details or go back to My offers.",
              })}
            </Text>
            {deal ? <SecondaryButton title={t("offersDashboard.editDeal")} onPress={openEditDeal} /> : null}
            <SecondaryButton
              title={t("dealAnalytics.backToOffersLabel", "Back to My offers")}
              accessibilityLabel={t("dealAnalytics.backToOffersLabel", "Back to My offers")}
              onPress={goBack}
            />
          </View>
        ) : (
          <View style={{ marginBottom: Spacing.xl }}>
            {claimsByDay.map((item) => (
              <View
                key={item.day}
                style={{
                  paddingVertical: Spacing.md,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                }}
              >
                <Text style={{ fontWeight: "700", fontSize: 16, color: theme.text }}>
                  {formatAppDateFromDayKey(item.day, i18n.language)}
                </Text>
                <Text style={{ color: theme.mutedText, marginTop: Spacing.xs, fontSize: 15 }}>
                  {t("dealAnalytics.dayRow", { claims: item.claims, redeems: item.redeems })}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={{ fontWeight: "700", fontSize: 17, marginBottom: Spacing.sm, color: theme.text }}>
          {t("businessDashboard.whatWorked")}
        </Text>
        <Text style={{ color: theme.mutedText, fontSize: 15, lineHeight: 22 }}>
          {bestTime ?? t("dealAnalytics.notEnoughData")}
        </Text>
      </ScrollView>
    </View>
  );
}
