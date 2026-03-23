import { useEffect, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { supabase } from "../../lib/supabase";
import { claimDeal } from "../../lib/functions";
import { checkForNewFavoriteDeals } from "../../lib/notifications";
import { isDealActiveNow } from "../../lib/deal-time";
import { DealCardPoster } from "../../components/deal-card-poster";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingSkeleton } from "../../components/ui/loading-skeleton";
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

export default function FavoritesScreen() {
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { sessionEmail, userId } = useBusiness();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [favoriteBusinessIds, setFavoriteBusinessIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingDealId, setClaimingDealId] = useState<string | null>(null);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [lastClaimDealId, setLastClaimDealId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await loadFavorites(userId);
    })();
  }, [userId]);

  async function loadFavorites(currentUserId: string | null) {
    if (!currentUserId) {
      setFavoriteBusinessIds([]);
      setDeals([]);
      return;
    }
    const { data, error } = await supabase
      .from("favorites")
      .select("business_id")
      .eq("user_id", currentUserId);
    if (error) {
      setBanner(error.message);
      return;
    }
    const ids = (data ?? []).map((row) => row.business_id);
    setFavoriteBusinessIds(ids);
    await loadDeals(ids);
  }

  async function loadDeals(businessIds: string[]) {
    if (businessIds.length === 0) {
      setDeals([]);
      setLoadingDeals(false);
      return;
    }
    setLoadingDeals(true);
    const { data, error } = await supabase
      .from("deals")
      .select("id,title,description,start_time,end_time,is_active,poster_url,business_id,price,businesses(name),is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone")
      .in("business_id", businessIds)
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
    setDeals(raw.filter((deal) => isDealActiveNow(deal)));
    setLoadingDeals(false);
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

  async function doClaim(dealId: string) {
    if (!sessionEmail) {
      setBanner("Log in to claim deals.");
      return;
    }
    if (claimingDealId) return;
    setClaimingDealId(dealId);
    try {
      const out = await claimDeal(dealId);
      setQrToken(out.token);
      setQrExpires(out.expires_at);
      setLastClaimDealId(dealId);
      setQrVisible(true);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : typeof e === "string"
          ? e
          : JSON.stringify(e, null, 2);
      setBanner(msg);
    } finally {
      setClaimingDealId(null);
    }
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

  async function onRefresh() {
    setRefreshing(true);
    await loadFavorites(userId);
    setRefreshing(false);
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
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>Favorites</Text>
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
          renderItem={({ item }) => (
            <DealCardPoster
              title={item.title ?? "Deal"}
              description={item.description}
              businessName={item.businesses?.name ?? "Local business"}
              posterUrl={item.poster_url}
              price={item.price}
              endTime={item.end_time}
              isFavorite={favoriteBusinessIds.includes(item.business_id)}
              onPress={() => router.push(`/deal/${item.id}`)}
              onToggleFavorite={() => toggleFavorite(item.business_id)}
              onClaim={() => doClaim(item.id)}
              claiming={claimingDealId === item.id}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              title="No favorites yet"
              message="Favorite a business to see deals here."
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
