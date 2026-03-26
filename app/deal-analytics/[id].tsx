import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { Banner } from "@/components/ui/banner";
import { MerchantInsightsPanel } from "@/components/merchant-insights-panel";
import { parseMerchantInsights, type MerchantInsightsRow } from "@/lib/merchant-insights";
import { formatValiditySummary } from "@/lib/deal-time";
import { formatAppDateFromDayKey } from "@/lib/i18n/format-datetime";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors } from "@/constants/theme";

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
};

function dayKey(dateStr: string) {
  const d = new Date(dateStr);
  return d.toISOString().slice(0, 10);
}

export default function DealAnalyticsDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bestTime, setBestTime] = useState<string | null>(null);
  const [insights, setInsights] = useState<MerchantInsightsRow | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setBanner(null);
    try {
      const { data: dealData, error: dealError } = await supabase
        .from("deals")
        .select("id,title,poster_url,start_time,end_time,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone")
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
      const msg = err instanceof Error ? err.message : t("dealAnalytics.errLoad");
      setBanner(msg);
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

  if (loading) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>
          {t("dealAnalytics.title")}
        </Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>{t("dealAnalytics.loading")}</Text>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("dealAnalytics.title")}</Text>
      {banner ? <Banner message={banner} tone="error" /> : null}
      <ScrollView
        style={{ flex: 1, marginTop: Spacing.md }}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {deal ? (
          <View style={{ marginBottom: Spacing.lg }}>
            <Text style={{ fontWeight: "700", fontSize: 20 }}>
              {deal.title ?? t("offersDashboard.dealFallback")}
            </Text>
            <Text style={{ opacity: 0.68, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
              {formatValiditySummary(deal, {
                lang: i18n.language,
                endsVerb: t("commonUi.dealEndsVerb"),
                t,
              })}
            </Text>
          </View>
        ) : null}

        <MerchantInsightsPanel insights={insights} />

        <Text style={{ fontWeight: "700", fontSize: 17, marginBottom: Spacing.md }}>
          {t("dealAnalytics.claimsOverTime")}
        </Text>
        {claimsByDay.length === 0 ? (
          <Text style={{ opacity: 0.7, marginBottom: Spacing.lg }}>{t("dealAnalytics.noClaims")}</Text>
        ) : (
          <View style={{ marginBottom: Spacing.xl }}>
            {claimsByDay.map((item) => (
              <View
                key={item.day}
                style={{
                  paddingVertical: Spacing.md,
                  borderBottomWidth: 1,
                  borderBottomColor: Colors.light.border,
                }}
              >
                <Text style={{ fontWeight: "700", fontSize: 16 }}>
                  {formatAppDateFromDayKey(item.day, i18n.language)}
                </Text>
                <Text style={{ opacity: 0.72, marginTop: Spacing.xs, fontSize: 15 }}>
                  {t("dealAnalytics.dayRow", { claims: item.claims, redeems: item.redeems })}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={{ fontWeight: "700", fontSize: 17, marginBottom: Spacing.sm }}>
          {t("businessDashboard.whatWorked")}
        </Text>
        <Text style={{ opacity: 0.72, fontSize: 15, lineHeight: 22 }}>
          {bestTime ?? t("dealAnalytics.notEnoughData")}
        </Text>
      </ScrollView>
    </View>
  );
}
