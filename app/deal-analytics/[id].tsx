import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Banner } from "../../components/ui/banner";
import { formatValiditySummary } from "../../lib/deal-time";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bestTime, setBestTime] = useState<string | null>(null);

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

      const now = new Date();
      const recent = (claimData ?? []).filter((c) => {
        const createdAt = new Date(c.created_at).getTime();
        return createdAt >= now.getTime() - 14 * 24 * 60 * 60 * 1000;
      });
      if (recent.length < 10) {
        setBestTime("Not enough data yet.");
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
          const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          const startLabel = hour % 12 === 0 ? 12 : hour % 12;
          const endHour = (hour + 2) % 24;
          const endLabel = endHour % 12 === 0 ? 12 : endHour % 12;
          const endPeriod = endHour < 12 ? "AM" : "PM";
          setBestTime(`Best time: ${dayNames[day]} ${startLabel}-${endLabel} ${endPeriod}`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load analytics.";
      setBanner(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

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
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>Deal analytics</Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>Deal analytics</Text>
      {banner ? <Banner message={banner} tone="error" /> : null}
      <ScrollView
        style={{ flex: 1, marginTop: Spacing.md }}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {deal ? (
          <View style={{ marginBottom: Spacing.lg }}>
            <Text style={{ fontWeight: "700", fontSize: 20 }}>{deal.title ?? "Deal"}</Text>
            <Text style={{ opacity: 0.68, marginTop: Spacing.sm, fontSize: 15, lineHeight: 22 }}>
              {formatValiditySummary(deal)}
            </Text>
          </View>
        ) : null}

        <Text style={{ fontWeight: "700", fontSize: 17, marginBottom: Spacing.md }}>Claims over time</Text>
        {claimsByDay.length === 0 ? (
          <Text style={{ opacity: 0.7, marginBottom: Spacing.lg }}>No claims yet.</Text>
        ) : (
          <View style={{ marginBottom: Spacing.xl }}>
            {claimsByDay.map((item) => (
              <View
                key={item.day}
                style={{
                  paddingVertical: Spacing.md,
                  borderBottomWidth: 1,
                  borderBottomColor: "#eee",
                }}
              >
                <Text style={{ fontWeight: "700", fontSize: 16 }}>{item.day}</Text>
                <Text style={{ opacity: 0.72, marginTop: Spacing.xs, fontSize: 15 }}>
                  Claims: {item.claims} · Redeems: {item.redeems}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={{ fontWeight: "700", fontSize: 17, marginBottom: Spacing.sm }}>What worked</Text>
        <Text style={{ opacity: 0.72, fontSize: 15, lineHeight: 22 }}>{bestTime ?? "Not enough data yet."}</Text>
      </ScrollView>
    </View>
  );
}
