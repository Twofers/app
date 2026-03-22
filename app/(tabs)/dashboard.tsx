import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useBusiness } from "../../hooks/use-business";
import { supabase } from "../../lib/supabase";
import { formatValiditySummary } from "../../lib/deal-time";
import { Banner } from "../../components/ui/banner";
import { LoadingSkeleton } from "../../components/ui/loading-skeleton";

export default function BusinessDashboard() {
  const router = useRouter();
  const { isLoggedIn, businessId, loading } = useBusiness();
  const [banner, setBanner] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [deals, setDeals] = useState<any[]>([]);
  const [summary, setSummary] = useState({
    claims: 0,
    redeems: 0,
    uniqueRedeemers: 0,
    conversion: 0,
  });

  useEffect(() => {
    if (!businessId) return;
    loadMetrics();
  }, [businessId]);

  async function loadMetrics() {
    if (!businessId) return;
    setLoadingMetrics(true);
    setBanner(null);
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: dealsData, error: dealsError } = await supabase
        .from("deals")
        .select("id,title,poster_url,start_time,end_time,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (dealsError) throw dealsError;
      const dealIds = (dealsData ?? []).map((d) => d.id);

      if (dealIds.length === 0) {
        setDeals([]);
        setSummary({ claims: 0, redeems: 0, uniqueRedeemers: 0, conversion: 0 });
        setLoadingMetrics(false);
        return;
      }

      const { data: claims, error: claimsError } = await supabase
        .from("deal_claims")
        .select("deal_id,user_id,created_at,redeemed_at")
        .in("deal_id", dealIds)
        .gte("created_at", thirtyDaysAgo);
      if (claimsError) throw claimsError;

      const perDealMap: Record<string, { claims: number; redeems: number; uniqueRedeemers: Set<string> }> = {};
      const uniqueRedeemersAll = new Set<string>();
      let claimCount = 0;
      let redeemCount = 0;

      (claims ?? []).forEach((c: any) => {
        claimCount += 1;
        if (!perDealMap[c.deal_id]) {
          perDealMap[c.deal_id] = { claims: 0, redeems: 0, uniqueRedeemers: new Set() };
        }
        perDealMap[c.deal_id].claims += 1;
        if (c.redeemed_at) {
          redeemCount += 1;
          perDealMap[c.deal_id].redeems += 1;
          perDealMap[c.deal_id].uniqueRedeemers.add(c.user_id);
          uniqueRedeemersAll.add(c.user_id);
        }
      });

      const hydrated = (dealsData ?? []).map((deal) => {
        const metrics = perDealMap[deal.id] ?? { claims: 0, redeems: 0, uniqueRedeemers: new Set() };
        const conversion = metrics.claims > 0 ? Math.round((metrics.redeems / metrics.claims) * 100) : 0;
        return {
          ...deal,
          claims: metrics.claims,
          redeems: metrics.redeems,
          uniqueRedeemers: metrics.uniqueRedeemers.size,
          conversion,
        };
      });

      setDeals(hydrated);
      setSummary({
        claims: claimCount,
        redeems: redeemCount,
        uniqueRedeemers: uniqueRedeemersAll.size,
        conversion: claimCount > 0 ? Math.round((redeemCount / claimCount) * 100) : 0,
      });
    } catch (err: any) {
      setBanner(err?.message ?? "Failed to load dashboard.");
    } finally {
      setLoadingMetrics(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadMetrics();
    setRefreshing(false);
  }

  return (
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Business Dashboard</Text>

      {!isLoggedIn ? (
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Please log in to view your dashboard.</Text>
      ) : loading ? (
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Loading...</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Create a business to unlock analytics.</Text>
      ) : (
        <View style={{ marginTop: 16, flex: 1 }}>
          {banner ? <Banner message={banner} tone="error" /> : null}

          <Text style={{ fontWeight: "700", marginBottom: 8 }}>Last 30 days</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Claims", value: summary.claims },
              { label: "Redeems", value: summary.redeems },
              { label: "Unique redeemers", value: summary.uniqueRedeemers },
              { label: "Conversion", value: `${summary.conversion}%` },
            ].map((item) => (
              <View
                key={item.label}
                style={{
                  flexBasis: "48%",
                  backgroundColor: "#f6f6f6",
                  borderRadius: 14,
                  padding: 12,
                }}
              >
                <Text style={{ fontSize: 12, opacity: 0.7 }}>{item.label}</Text>
                <Text style={{ fontSize: 20, fontWeight: "700", marginTop: 4 }}>{item.value}</Text>
              </View>
            ))}
          </View>

          {loadingMetrics ? (
            <LoadingSkeleton rows={2} />
          ) : (
            <FlatList
              data={deals}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ paddingBottom: 40 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => router.push(`/deal-analytics/${item.id}`)}
                  style={{
                    borderRadius: 16,
                    backgroundColor: "#fff",
                    padding: 12,
                    marginBottom: 12,
                    shadowColor: "#000",
                    shadowOpacity: 0.06,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 1,
                  }}
                >
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    {item.poster_url ? (
                      <Image
                        source={{ uri: item.poster_url }}
                        style={{ height: 64, width: 64, borderRadius: 12 }}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={{ height: 64, width: 64, borderRadius: 12, backgroundColor: "#eee" }} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700" }}>{item.title ?? "Deal"}</Text>
                      <Text style={{ opacity: 0.7, marginTop: 4 }}>
                        {formatValiditySummary(item)}
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                        <Text style={{ fontSize: 12, opacity: 0.7 }}>Claims: {item.claims}</Text>
                        <Text style={{ fontSize: 12, opacity: 0.7 }}>Redeems: {item.redeems}</Text>
                        <Text style={{ fontSize: 12, opacity: 0.7 }}>Unique: {item.uniqueRedeemers}</Text>
                        <Text style={{ fontSize: 12, opacity: 0.7 }}>Conversion: {item.conversion}%</Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={{ opacity: 0.7 }}>No deals yet. Create one to see analytics.</Text>
              }
            />
          )}
        </View>
      )}
    </View>
  );
}
