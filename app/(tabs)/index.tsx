import { useCallback, useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { supabase } from "../../lib/supabase";
import { claimDeal } from "../../lib/functions";
import { checkForNewFavoriteDeals } from "../../lib/notifications";
import { isDealActiveNow } from "../../lib/deal-time";
import { DealCardPoster } from "../../components/deal-card-poster";
import { LoadingSkeleton } from "../../components/ui/loading-skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { Banner } from "../../components/ui/banner";
import { QrModal } from "../../components/qr-modal";
import { useBusiness } from "../../hooks/use-business";

type Deal = {
  id: string;
  title: string | null;
  description: string | null;
  end_time: string;
  is_active: boolean;
  poster_url: string | null;
  business_id: string;
  price: number | null;
  max_claims: number | null;
  businesses?: {
    name: string | null;
  } | null;
  start_time: string;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
};

export default function HomeDeals() {
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { isLoggedIn, sessionEmail, userId } = useBusiness();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [claimingDealId, setClaimingDealId] = useState<string | null>(null);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [lastClaimDealId, setLastClaimDealId] = useState<string | null>(null);
  const [favoriteBusinessIds, setFavoriteBusinessIds] = useState<string[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [claimCounts, setClaimCounts] = useState<Record<string, number>>({});
  const [claimStatus, setClaimStatus] = useState<Record<string, { message: string; tone: "success" | "error" | "info" }>>({});

  useEffect(() => {
    (async () => {
      await loadDeals();
      await loadFavorites(userId);
    })();
  }, []);

  async function loadDeals() {
    setLoadingDeals(true);
    const { data, error } = await supabase
      .from("deals")
      .select("id,title,description,start_time,end_time,is_active,poster_url,business_id,price,max_claims,businesses(name),is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone")
      .eq("is_active", true)
      .gte("end_time", new Date().toISOString())
      .order("end_time", { ascending: true })
      .limit(50);

    if (error) {
      setBanner(error.message);
      setLoadingDeals(false);
      return;
    }

    const raw = (data ?? []) as Deal[];
    const filtered = raw.filter((deal) => isDealActiveNow(deal));
    setDeals(filtered);
    await loadClaimCounts(filtered.map((d) => d.id));
    setLoadingDeals(false);
  }

  async function loadFavorites(currentUserId: string | null) {
    if (!currentUserId) {
      setFavoriteBusinessIds([]);
      return;
    }
    const { data, error } = await supabase
      .from("favorites")
      .select("business_id")
      .eq("user_id", currentUserId);
    if (error) {
      setFavoriteBusinessIds([]);
      return;
    }
    setFavoriteBusinessIds((data ?? []).map((row) => row.business_id));
  }

  async function toggleFavorite(businessId: string) {
    if (!userId) {
      setBanner("Log in to save favorites.");
      return;
    }
    const isFav = favoriteBusinessIds.includes(businessId);
    const next = isFav
      ? favoriteBusinessIds.filter((id) => id !== businessId)
      : [...favoriteBusinessIds, businessId];
    setFavoriteBusinessIds(next);
    if (isFav) {
      const { error } = await supabase
        .from("favorites")
        .delete()
        .eq("user_id", userId)
        .eq("business_id", businessId);
      if (error) {
        setFavoriteBusinessIds(favoriteBusinessIds);
        setBanner(error.message);
      }
    } else {
      const { error } = await supabase
        .from("favorites")
        .insert({ user_id: userId, business_id: businessId });
      if (error) {
        setFavoriteBusinessIds(favoriteBusinessIds);
        setBanner(error.message);
      }
    }
  }

  useFocusEffect(
    useCallback(() => {
      loadDeals();
      loadFavorites(userId);
    }, [userId])
  );

  async function doClaim(dealId: string) {
    try {
      if (!isLoggedIn) {
        setBanner("Log in to claim deals.");
        return;
      }
      if (claimingDealId) return;
      setClaimingDealId(dealId);
      setClaimStatus((prev) => ({ ...prev, [dealId]: { message: "Claiming...", tone: "info" } }));

      const out = await claimDeal(dealId);

      // deployed function returns { token, expires_at }
      setQrToken(out.token);
      setQrExpires(out.expires_at);
      setLastClaimDealId(dealId);
      setQrVisible(true);
      setClaimStatus((prev) => ({ ...prev, [dealId]: { message: "Claimed. Show the QR.", tone: "success" } }));
      await loadClaimCounts([dealId]);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : typeof e === "string"
          ? e
          : JSON.stringify(e, null, 2);
      setClaimStatus((prev) => ({ ...prev, [dealId]: { message: msg, tone: "error" } }));
    } finally {
      setClaimingDealId(null);
    }
  }

  async function loadClaimCounts(dealIds: string[]) {
    if (dealIds.length === 0) return;
    const { data, error } = await supabase
      .from("deal_claims")
      .select("deal_id")
      .in("deal_id", dealIds);
    if (error) return;
    const counts: Record<string, number> = {};
    (data ?? []).forEach((row: any) => {
      counts[row.deal_id] = (counts[row.deal_id] ?? 0) + 1;
    });
    setClaimCounts((prev) => ({ ...prev, ...counts }));
  }

  async function refreshQr() {
    if (!lastClaimDealId) {
      setBanner("Claim a deal first to refresh the QR.");
      return;
    }
    if (refreshingQr) return;
    setRefreshingQr(true);
    try {
      const out = await claimDeal(lastClaimDealId);
      setQrToken(out.token);
      setQrExpires(out.expires_at);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : typeof e === "string"
          ? e
          : JSON.stringify(e, null, 2);
      setBanner(msg);
    } finally {
      setRefreshingQr(false);
    }
  }

  useEffect(() => {
    if (!userId) return;
    if (favoriteBusinessIds.length === 0) return;
    checkForNewFavoriteDeals({
      userId,
      favoriteBusinessIds,
    });
  }, [userId, favoriteBusinessIds]);

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>Deals</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15 }}>
        {sessionEmail ? `Logged in: ${sessionEmail}` : "Not logged in"}
      </Text>

      {banner ? <Banner message={banner} tone="error" /> : null}

      {loadingDeals ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={deals}
          keyExtractor={(d) => d.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
          renderItem={({ item }) => (
            <DealCardPoster
              title={item.title ?? "Deal"}
              description={item.description}
              businessName={item.businesses?.name ?? "Local business"}
              posterUrl={item.poster_url}
              price={item.price}
              endTime={item.end_time}
              remainingClaims={
                typeof item.max_claims === "number"
                  ? Math.max(0, item.max_claims - (claimCounts[item.id] ?? 0))
                  : null
              }
              isFavorite={favoriteBusinessIds.includes(item.business_id)}
              onPress={() => router.push(`/deal/${item.id}`)}
              onToggleFavorite={() => toggleFavorite(item.business_id)}
              onClaim={() => doClaim(item.id)}
              claiming={claimingDealId === item.id}
              statusMessage={claimStatus[item.id]?.message}
              statusTone={claimStatus[item.id]?.tone}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              title="No deals yet"
              message="Create a business and post your first deal."
            />
          }
        />
      )}

      <QrModal
        visible={qrVisible}
        token={qrToken}
        expiresAt={qrExpires}
        onHide={() => setQrVisible(false)}
        onRefresh={refreshQr}
        refreshing={refreshingQr}
      />
    </View>
  );
}
