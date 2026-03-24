import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useBusiness } from "../../hooks/use-business";
import { supabase } from "../../lib/supabase";
import { formatValiditySummary } from "../../lib/deal-time";
import { Banner } from "../../components/ui/banner";
import { LoadingSkeleton } from "../../components/ui/loading-skeleton";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";

type DealRow = {
  id: string;
  title: string | null;
  poster_url: string | null;
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
  uniqueRedeemers: number;
  conversion: number;
};

export default function BusinessDashboard() {
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { isLoggedIn, businessId, loading } = useBusiness();
  const [banner, setBanner] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [endingDealId, setEndingDealId] = useState<string | null>(null);
  const [summary, setSummary] = useState({
    claims: 0,
    redeems: 0,
    uniqueRedeemers: 0,
    conversion: 0,
  });

  const loadMetrics = useCallback(async () => {
    if (!businessId) return;
    setLoadingMetrics(true);
    setBanner(null);
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: dealsData, error: dealsError } = await supabase
        .from("deals")
        .select(
          "id,title,poster_url,start_time,end_time,is_active,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone",
        )
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

      (claims ?? []).forEach((c: { deal_id: string; user_id: string; redeemed_at: string | null }) => {
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

      const hydrated: DealRow[] = (dealsData ?? []).map((deal: Omit<DealRow, "claims" | "redeems" | "uniqueRedeemers" | "conversion">) => {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load dashboard.";
      setBanner(msg);
    } finally {
      setLoadingMetrics(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    void loadMetrics();
  }, [businessId, loadMetrics]);

  async function onRefresh() {
    setRefreshing(true);
    await loadMetrics();
    setRefreshing(false);
  }

  async function endDealEarly(dealId: string) {
    if (!businessId || endingDealId) return;
    setEndingDealId(dealId);
    setBanner(null);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("deals")
        .update({ is_active: false, end_time: now })
        .eq("id", dealId)
        .eq("business_id", businessId);
      if (error) throw error;
      await loadMetrics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not end deal.";
      setBanner(msg);
    } finally {
      setEndingDealId(null);
    }
  }

  const dealActive = (item: DealRow) =>
    item.is_active && new Date(item.end_time).getTime() > Date.now();

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>My offers</Text>
      <Text style={{ marginTop: Spacing.xs, opacity: 0.65, fontSize: 15, marginBottom: Spacing.md }}>
        Last 30 days · tap a card for analytics
      </Text>

      {!isLoggedIn ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>Please log in to view your dashboard.</Text>
      ) : loading ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>Loading...</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: Spacing.md, opacity: 0.7 }}>Create a business to unlock analytics.</Text>
      ) : (
        <View style={{ marginTop: Spacing.sm, flex: 1 }}>
          {banner ? <Banner message={banner} tone="error" /> : null}

          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm, fontSize: 15 }}>Overview</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.md, marginBottom: Spacing.lg }}>
            {[
              { label: "Claims", value: summary.claims },
              { label: "Redeems", value: summary.redeems },
              { label: "Unique redeemers", value: summary.uniqueRedeemers },
              { label: "Conversion", value: `${summary.conversion}%` },
            ].map((item) => (
              <View
                key={item.label}
                style={{
                  flexBasis: "47%",
                  flexGrow: 1,
                  backgroundColor: "#f4f4f4",
                  borderRadius: 16,
                  padding: Spacing.md,
                }}
              >
                <Text style={{ fontSize: 12, opacity: 0.65, fontWeight: "600" }}>{item.label}</Text>
                <Text style={{ fontSize: 22, fontWeight: "700", marginTop: Spacing.xs }}>{item.value}</Text>
              </View>
            ))}
          </View>

          <Text style={{ fontWeight: "700", marginBottom: Spacing.sm, fontSize: 15 }}>Your deals</Text>

          {loadingMetrics ? (
            <LoadingSkeleton rows={2} />
          ) : (
            <FlatList
              style={{ flex: 1 }}
              data={deals}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
              ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
              renderItem={({ item }) => {
                const active = dealActive(item);
                return (
                  <View
                    style={{
                      borderRadius: 18,
                      backgroundColor: "#fff",
                      padding: Spacing.lg,
                      shadowColor: "#000",
                      shadowOpacity: 0.07,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: 2,
                      overflow: "hidden",
                    }}
                  >
                    <Pressable
                      onPress={() => router.push(`/deal-analytics/${item.id}`)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
                    >
                      <View style={{ flexDirection: "row", gap: Spacing.md }}>
                        {item.poster_url ? (
                          <Image
                            source={{ uri: item.poster_url }}
                            style={{ height: 88, width: 88, borderRadius: 14 }}
                            contentFit="cover"
                          />
                        ) : (
                          <View
                            style={{
                              height: 88,
                              width: 88,
                              borderRadius: 14,
                              backgroundColor: "#ececec",
                            }}
                          />
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontWeight: "700", fontSize: 17 }} numberOfLines={2}>
                            {item.title ?? "Deal"}
                          </Text>
                          <Text style={{ opacity: 0.68, marginTop: Spacing.xs, fontSize: 14 }} numberOfLines={2}>
                            {formatValiditySummary(item)}
                          </Text>
                          <View
                            style={{
                              flexDirection: "row",
                              flexWrap: "wrap",
                              gap: Spacing.sm,
                              marginTop: Spacing.md,
                            }}
                          >
                            <Text style={{ fontSize: 13, opacity: 0.72 }}>Claims {item.claims}</Text>
                            <Text style={{ fontSize: 13, opacity: 0.72 }}>· Redeems {item.redeems}</Text>
                            <Text style={{ fontSize: 13, opacity: 0.72 }}>· Conv. {item.conversion}%</Text>
                          </View>
                        </View>
                      </View>
                    </Pressable>

                    <View
                      style={{
                        marginTop: Spacing.lg,
                        paddingTop: Spacing.md,
                        borderTopWidth: 1,
                        borderTopColor: "#f0f0f0",
                        gap: Spacing.sm,
                      }}
                    >
                      <View
                        style={{
                          alignSelf: "flex-start",
                          paddingHorizontal: Spacing.sm,
                          paddingVertical: Spacing.xs,
                          borderRadius: 8,
                          backgroundColor: active ? "#e8f5e9" : "#f0f0f0",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: active ? "#1b5e20" : "#555",
                          }}
                        >
                          {active ? "Live" : "Ended"}
                        </Text>
                      </View>
                      {active ? (
                        <Pressable
                          onPress={() => endDealEarly(item.id)}
                          disabled={endingDealId === item.id}
                          style={{
                            minHeight: 48,
                            paddingVertical: Spacing.md,
                            borderRadius: 12,
                            backgroundColor: "#fff",
                            borderWidth: 1,
                            borderColor: "#c62828",
                            opacity: endingDealId === item.id ? 0.65 : 1,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {endingDealId === item.id ? (
                            <ActivityIndicator color="#c62828" />
                          ) : (
                            <Text style={{ color: "#c62828", fontWeight: "700", textAlign: "center", fontSize: 15 }}>
                              End deal early
                            </Text>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={
                <Text style={{ opacity: 0.7, fontSize: 15 }}>No deals yet. Create one to see analytics.</Text>
              }
            />
          )}
        </View>
      )}
    </View>
  );
}
