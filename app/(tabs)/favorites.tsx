import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { supabase } from "../../lib/supabase";
import { claimDeal } from "../../lib/functions";
import { syncConsumerDealNotifications } from "../../lib/notifications";
import { isDealActiveNow } from "../../lib/deal-time";
import { DealCardPoster } from "../../components/deal-card-poster";
import { EmptyState } from "../../components/ui/empty-state";
import { LoadingSkeleton } from "../../components/ui/loading-skeleton";
import { Banner } from "../../components/ui/banner";
import { QrModal } from "../../components/qr-modal";
import { useBusiness } from "../../hooks/use-business";
import { translateFunctionErrorMessage } from "../../lib/i18n/function-errors";
import { resolveDealPosterDisplayUri } from "../../lib/deal-poster-url";

type Deal = {
  id: string;
  title: string | null;
  description: string | null;
  end_time: string;
  is_active: boolean;
  poster_url: string | null;
  poster_storage_path?: string | null;
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
  const { t } = useTranslation();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { isLoggedIn, sessionEmail, userId } = useBusiness();
  const mapFnErr = (raw: string) => translateFunctionErrorMessage(raw, t);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [favoriteBusinessIds, setFavoriteBusinessIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingDealId, setClaimingDealId] = useState<string | null>(null);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [claimSuccessToastNonce, setClaimSuccessToastNonce] = useState(0);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [lastClaimDealId, setLastClaimDealId] = useState<string | null>(null);

  const loadDealsForBusinesses = useCallback(async (businessIds: string[]) => {
    if (businessIds.length === 0) {
      setDeals([]);
      setLoadingDeals(false);
      return;
    }
    setLoadingDeals(true);
    const { data, error } = await supabase
      .from("deals")
      .select("id,title,description,start_time,end_time,is_active,poster_url,poster_storage_path,business_id,price,businesses(name),is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone")
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
    const raw = (data ?? []) as unknown as Deal[];
    setDeals(raw.filter((deal) => isDealActiveNow(deal)));
    setLoadingDeals(false);
  }, []);

  const loadFavorites = useCallback(
    async (currentUserId: string | null) => {
      if (!currentUserId) {
        setFavoriteBusinessIds([]);
        setDeals([]);
        setLoadingDeals(false);
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
      await loadDealsForBusinesses(ids);
    },
    [loadDealsForBusinesses],
  );

  useEffect(() => {
    void loadFavorites(userId);
  }, [userId, loadFavorites]);

  async function toggleFavorite(businessId: string) {
    if (!userId) {
      setBanner(t("dealDetail.errLoginFavorite"));
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
    if (!isLoggedIn) {
      setBanner(t("dealDetail.errLoginClaim"));
      return;
    }
    if (claimingDealId) return;
    setClaimingDealId(dealId);
    try {
      const out = await claimDeal(dealId);
      if (out.claim_id) setClaimSuccessToastNonce((n) => n + 1);
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
      setBanner(mapFnErr(msg));
    } finally {
      setClaimingDealId(null);
    }
  }

  async function refreshQr() {
    if (!lastClaimDealId) {
      setBanner(t("consumerWallet.errNoDealForQr"));
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
      setBanner(mapFnErr(msg));
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
    syncConsumerDealNotifications({
      userId,
      favoriteBusinessIds,
    });
  }, [userId, favoriteBusinessIds]);

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("tabs.favorites")}</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15 }}>
        {sessionEmail ? t("dealsBrowse.loggedInAs", { email: sessionEmail }) : t("dealsBrowse.notLoggedIn")}
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
              title={item.title ?? t("dealDetail.dealFallback")}
              description={item.description}
              businessName={item.businesses?.name ?? t("dealDetail.localBusiness")}
              posterUrl={resolveDealPosterDisplayUri(item.poster_url, item.poster_storage_path)}
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
            <EmptyState title={t("favorites.emptyTitle")} message={t("favorites.emptyMessage")} />
          }
        />
      )}

      <QrModal
        visible={qrVisible}
        token={qrToken}
        expiresAt={qrExpires}
        successToastNonce={claimSuccessToastNonce}
        onHide={() => setQrVisible(false)}
        onRefresh={refreshQr}
        refreshing={refreshingQr}
      />
    </View>
  );
}
