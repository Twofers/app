import { useEffect, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { Banner } from "../../components/ui/banner";
import { formatValiditySummary } from "../../lib/deal-time";

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
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bestTime, setBestTime] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  async function loadData() {
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
          const startPeriod = hour < 12 ? "AM" : "PM";
          const endPeriod = endHour < 12 ? "AM" : "PM";
          setBestTime(`Best time: ${dayNames[day]} ${startLabel}-${endLabel} ${endPeriod}`);
        }
      }
    } catch (err: any) {
      setBanner(err?.message ?? "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }

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
      <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>Deal analytics</Text>
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Deal analytics</Text>
      {banner ? <Banner message={banner} tone="error" /> : null}
      {deal ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: "700" }}>{deal.title ?? "Deal"}</Text>
          <Text style={{ opacity: 0.7, marginTop: 4 }}>{formatValiditySummary(deal)}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: 16 }}>
        <Text style={{ fontWeight: "700" }}>Claims over time</Text>
        <FlatList
          data={claimsByDay}
          keyExtractor={(item) => item.day}
          renderItem={({ item }) => (
            <View
              style={{
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: "#eee",
              }}
            >
              <Text style={{ fontWeight: "600" }}>{item.day}</Text>
              <Text style={{ opacity: 0.7 }}>
                Claims: {item.claims} · Redeems: {item.redeems}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={{ opacity: 0.7 }}>No claims yet.</Text>}
        />
      </View>

      <View style={{ marginTop: 16 }}>
        <Text style={{ fontWeight: "700" }}>What worked</Text>
        <Text style={{ marginTop: 6, opacity: 0.7 }}>{bestTime ?? "Not enough data yet."}</Text>
      </View>
    </View>
  );
}
