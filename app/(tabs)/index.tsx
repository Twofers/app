import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { claimDeal } from "@/lib/functions";
import { syncConsumerDealNotifications } from "@/lib/notifications";
import { isDealActiveNow } from "@/lib/deal-time";
import { DealCardPoster } from "@/components/deal-card-poster";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Banner } from "@/components/ui/banner";
import { QrModal } from "@/components/qr-modal";
import { BusinessRowCard } from "@/components/business-row-card";
import { useBusiness } from "@/hooks/use-business";
import { dealMatchesSearch } from "@/lib/deals-discovery-filters";
import { haversineMiles } from "@/lib/geo";
import { translateFunctionErrorMessage } from "@/lib/i18n/function-errors";
import { getConsumerPreferences, setLastKnownConsumerCoords } from "@/lib/consumer-preferences";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { logPostgrestError } from "@/lib/supabase-client-log";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import type { ConsumerDealStatusKey } from "@/components/deal-status-pill";
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
  max_claims: number | null;
  businesses?: {
    name: string | null;
    category: string | null;
    location: string | null;
    latitude: number | string | null;
    longitude: number | string | null;
  } | null;
  start_time: string;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
};

type BusinessRow = {
  id: string;
  name: string;
  location: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

function bizCoords(b: Deal["businesses"]): { lat: number; lng: number } | null {
  if (!b) return null;
  const lat = typeof b.latitude === "number" ? b.latitude : b.latitude != null ? Number(b.latitude) : NaN;
  const lng = typeof b.longitude === "number" ? b.longitude : b.longitude != null ? Number(b.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function dealStatusForUser(
  dealId: string,
  map: Map<string, { redeemed_at: string | null; expires_at: string }>,
  now: number,
): ConsumerDealStatusKey {
  const row = map.get(dealId);
  if (!row) return "live";
  if (row.redeemed_at) return "redeemed";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  return "claimed";
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { isLoggedIn, sessionEmail, userId } = useBusiness();
  const mapClaimError = (raw: string) => translateFunctionErrorMessage(raw, t);

  const [deals, setDeals] = useState<Deal[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [userGeo, setUserGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [claimingDealId, setClaimingDealId] = useState<string | null>(null);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [lastClaimDealId, setLastClaimDealId] = useState<string | null>(null);
  const [favoriteBusinessIds, setFavoriteBusinessIds] = useState<string[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [loadingBiz, setLoadingBiz] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [claimCounts, setClaimCounts] = useState<Record<string, number>>({});
  const [claimStatus, setClaimStatus] = useState<Record<string, { message: string; tone: "success" | "error" | "info" }>>({});
  const [userClaimsByDeal, setUserClaimsByDeal] = useState<
    Map<string, { redeemed_at: string | null; expires_at: string }>
  >(() => new Map());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showAllLiveDeals, setShowAllLiveDeals] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(3);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const dealsRef = useRef(deals);
  dealsRef.current = deals;

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadClaimCounts = useCallback(async (dealIds: string[]) => {
    if (dealIds.length === 0) return;
    const { data, error } = await supabase.from("deal_claims").select("deal_id").in("deal_id", dealIds);
    if (error) return;
    const counts: Record<string, number> = {};
    (data ?? []).forEach((row: { deal_id: string }) => {
      counts[row.deal_id] = (counts[row.deal_id] ?? 0) + 1;
    });
    setClaimCounts((prev) => ({ ...prev, ...counts }));
  }, []);

  const loadUserClaims = useCallback(
    async (dealIds: string[]) => {
      if (!userId || dealIds.length === 0) {
        setUserClaimsByDeal(new Map());
        return;
      }
      const { data, error } = await supabase
        .from("deal_claims")
        .select("deal_id,redeemed_at,expires_at,created_at")
        .eq("user_id", userId)
        .in("deal_id", dealIds)
        .order("created_at", { ascending: false });
      if (error) {
        setUserClaimsByDeal(new Map());
        return;
      }
      const m = new Map<string, { redeemed_at: string | null; expires_at: string }>();
      for (const row of data ?? []) {
        const did = row.deal_id as string;
        if (!m.has(did)) {
          m.set(did, { redeemed_at: row.redeemed_at as string | null, expires_at: row.expires_at as string });
        }
      }
      setUserClaimsByDeal(m);
    },
    [userId],
  );

  const loadDeals = useCallback(async () => {
    setLoadingDeals(true);
    const { data, error } = await supabase
      .from("deals")
      .select(
        "id,title,description,start_time,end_time,is_active,poster_url,poster_storage_path,business_id,price,max_claims,businesses(name,category,location,latitude,longitude),is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone",
      )
      .eq("is_active", true)
      .gte("end_time", new Date().toISOString())
      .order("end_time", { ascending: true })
      .limit(80);

    if (error) {
      logPostgrestError("home screen deals", error);
      setBanner(t("consumerHome.loadDealsError"));
      setDeals([]);
      setLoadingDeals(false);
      return;
    }

    const raw = (data ?? []) as unknown as Deal[];
    const filtered = raw.filter((deal) => isDealActiveNow(deal));
    setDeals(filtered);
    await loadClaimCounts(filtered.map((d) => d.id));
    await loadUserClaims(filtered.map((d) => d.id));
    setLoadingDeals(false);
  }, [loadClaimCounts, loadUserClaims, t]);

  const loadBusinesses = useCallback(async () => {
    setLoadingBiz(true);
    const { data, error } = await supabase
      .from("businesses")
      .select("id,name,location,latitude,longitude")
      .order("name", { ascending: true })
      .limit(300);
    if (error) {
      logPostgrestError("home screen businesses", error);
      setBusinesses([]);
    } else {
      setBusinesses((data ?? []) as BusinessRow[]);
    }
    setLoadingBiz(false);
  }, []);

  const loadFavorites = useCallback(async (currentUserId: string | null) => {
    if (!currentUserId) {
      setFavoriteBusinessIds([]);
      return;
    }
    const { data, error } = await supabase.from("favorites").select("business_id").eq("user_id", currentUserId);
    if (error) {
      setFavoriteBusinessIds([]);
      return;
    }
    setFavoriteBusinessIds((data ?? []).map((row) => row.business_id));
  }, []);

  const hydrateLocationFromPrefs = useCallback(async () => {
    const prefs = await getConsumerPreferences();
    setRadiusMiles(prefs.radiusMiles);
    const coords = await resolveConsumerCoordinates(prefs);
    if (coords) {
      setUserGeo({ lat: coords.lat, lng: coords.lng });
      await setLastKnownConsumerCoords(coords.lat, coords.lng);
    } else {
      setUserGeo(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDeals();
      void loadBusinesses();
      void loadFavorites(userId);
      void hydrateLocationFromPrefs();
    }, [loadDeals, loadBusinesses, loadFavorites, userId, hydrateLocationFromPrefs]),
  );

  useEffect(() => {
    if (!userId) return;
    void syncConsumerDealNotifications({ userId, favoriteBusinessIds });
  }, [userId, favoriteBusinessIds, deals.length]);

  async function toggleFavorite(businessId: string) {
    if (!userId) {
      setBanner(t("dealDetail.errLoginFavorite"));
      return;
    }
    const isFav = favoriteBusinessIds.includes(businessId);
    const next = isFav ? favoriteBusinessIds.filter((id) => id !== businessId) : [...favoriteBusinessIds, businessId];
    setFavoriteBusinessIds(next);
    if (isFav) {
      const { error } = await supabase.from("favorites").delete().eq("user_id", userId).eq("business_id", businessId);
      if (error) {
        setFavoriteBusinessIds(favoriteBusinessIds);
        setBanner(error.message);
      }
    } else {
      const { error } = await supabase.from("favorites").insert({ user_id: userId, business_id: businessId });
      if (error) {
        setFavoriteBusinessIds(favoriteBusinessIds);
        setBanner(error.message);
      }
    }
  }

  async function doClaim(dealId: string) {
    try {
      if (!isLoggedIn) {
        setBanner(t("dealDetail.errLoginClaim"));
        return;
      }
      if (claimingDealId) return;
      setClaimingDealId(dealId);
      setClaimStatus((prev) => ({ ...prev, [dealId]: { message: t("dealsBrowse.statusClaiming"), tone: "info" } }));

      const out = await claimDeal(dealId);

      setQrToken(out.token);
      setQrExpires(out.expires_at);
      setLastClaimDealId(dealId);
      setQrVisible(true);
      setClaimStatus((prev) => ({
        ...prev,
        [dealId]: { message: t("dealsBrowse.statusClaimedShowQr"), tone: "success" },
      }));
      await loadClaimCounts([dealId]);
      await loadUserClaims(dealsRef.current.map((d) => d.id));
    } catch (e: unknown) {
      const msg =
        typeof (e as { message?: string })?.message === "string"
          ? (e as { message: string }).message
          : typeof e === "string"
            ? e
            : JSON.stringify(e, null, 2);
      setClaimStatus((prev) => ({ ...prev, [dealId]: { message: mapClaimError(msg), tone: "error" } }));
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
    } catch (e: unknown) {
      const msg =
        typeof (e as { message?: string })?.message === "string"
          ? (e as { message: string }).message
          : typeof e === "string"
            ? e
            : JSON.stringify(e, null, 2);
      setBanner(mapClaimError(msg));
    } finally {
      setRefreshingQr(false);
    }
  }

  const searchFilteredDeals = useMemo(
    () => deals.filter((d) => dealMatchesSearch(d, searchQuery)),
    [deals, searchQuery],
  );

  const dealsWithinRadius = useMemo(() => {
    if (!userGeo) return searchFilteredDeals;
    const fav = new Set(favoriteBusinessIds);
    return searchFilteredDeals.filter((d) => {
      if (fav.has(d.business_id)) return true;
      const c = bizCoords(d.businesses);
      if (!c) return false;
      return haversineMiles(userGeo.lat, userGeo.lng, c.lat, c.lng) <= radiusMiles;
    });
  }, [searchFilteredDeals, userGeo, radiusMiles, favoriteBusinessIds]);

  const liveDealsDisplay = useMemo(() => {
    let list = showAllLiveDeals ? searchFilteredDeals : dealsWithinRadius;
    if (favoritesOnly) {
      list = list.filter((d) => favoriteBusinessIds.includes(d.business_id));
    }
    if (userGeo) {
      list = [...list].sort((a, b) => {
        const ca = bizCoords(a.businesses);
        const cb = bizCoords(b.businesses);
        const da = ca ? haversineMiles(userGeo.lat, userGeo.lng, ca.lat, ca.lng) : Number.POSITIVE_INFINITY;
        const db = cb ? haversineMiles(userGeo.lat, userGeo.lng, cb.lat, cb.lng) : Number.POSITIVE_INFINITY;
        return da - db;
      });
    }
    return list;
  }, [searchFilteredDeals, dealsWithinRadius, showAllLiveDeals, favoritesOnly, favoriteBusinessIds, userGeo]);

  const businessesDisplay = useMemo(() => {
    let list = businesses;
    if (favoritesOnly) {
      list = list.filter((b) => favoriteBusinessIds.includes(b.id));
    }
    if (userGeo) {
      list = [...list].sort((a, b) => {
        const la =
          typeof a.latitude === "number" ? a.latitude : a.latitude != null ? Number(a.latitude) : NaN;
        const ln =
          typeof a.longitude === "number" ? a.longitude : a.longitude != null ? Number(a.longitude) : NaN;
        const lb =
          typeof b.latitude === "number" ? b.latitude : b.latitude != null ? Number(b.latitude) : NaN;
        const bn =
          typeof b.longitude === "number" ? b.longitude : b.longitude != null ? Number(b.longitude) : NaN;
        const da =
          Number.isFinite(la) && Number.isFinite(ln)
            ? haversineMiles(userGeo.lat, userGeo.lng, la, ln)
            : Number.POSITIVE_INFINITY;
        const db =
          Number.isFinite(lb) && Number.isFinite(bn)
            ? haversineMiles(userGeo.lat, userGeo.lng, lb, bn)
            : Number.POSITIVE_INFINITY;
        return da - db;
      });
    }
    return list;
  }, [businesses, favoritesOnly, favoriteBusinessIds, userGeo]);

  const liveDealIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of deals) {
      s.add(d.business_id);
    }
    return s;
  }, [deals]);

  const emptyNearbyLive =
    !loadingDeals && liveDealsDisplay.length === 0 && searchFilteredDeals.length > 0 && !showAllLiveDeals;

  const listHeader = (
    <View style={{ marginBottom: Spacing.md }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("tabs.home")}</Text>
      <Text style={{ marginTop: 6, fontSize: 15, opacity: 0.62, lineHeight: 22 }}>{t("consumerHome.tagline")}</Text>
      {sessionEmail ? (
        <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.55, fontSize: 14 }}>
          {t("dealsBrowse.loggedInAs", { email: sessionEmail })}
        </Text>
      ) : null}

      {banner ? <Banner message={banner} tone="error" /> : null}

      <View style={{ marginBottom: Spacing.md, gap: Spacing.sm }}>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t("dealsBrowse.searchPlaceholder")}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={{
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 12,
            paddingVertical: Spacing.sm,
            paddingHorizontal: Spacing.md,
            fontSize: 16,
          }}
        />
        <Pressable onPress={() => router.push("/(tabs)/settings" as Href)} accessibilityRole="button">
          <Text style={{ fontSize: 13, opacity: 0.55, lineHeight: 18 }} numberOfLines={2}>
            {userGeo
              ? t("consumerHome.sortingHintWithLocation", { miles: radiusMiles })
              : t("consumerHome.sortingHintNoLocation")}
          </Text>
        </Pressable>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: Spacing.sm,
          gap: Spacing.md,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "800", flex: 1 }}>{t("consumerHome.liveNearYou")}</Text>
        <Pressable
          onPress={() => setFavoritesOnly(!favoritesOnly)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityState={{ selected: favoritesOnly }}
          accessibilityLabel={favoritesOnly ? t("consumerHome.favoritesOn") : t("consumerHome.favoritesOff")}
          style={({ pressed }) => ({
            padding: Spacing.sm,
            borderRadius: 22,
            backgroundColor: favoritesOnly ? "rgba(224,36,94,0.12)" : pressed ? "#f4f4f5" : "transparent",
          })}
        >
          <MaterialIcons
            name={favoritesOnly ? "favorite" : "favorite-border"}
            size={26}
            color={favoritesOnly ? "#e0245e" : "#666"}
          />
        </Pressable>
      </View>

      {favoritesOnly ? (
        <Text style={{ fontSize: 13, opacity: 0.55, marginBottom: Spacing.md, lineHeight: 18 }}>
          {t("consumerHome.favoritesOnlyActive")}
        </Text>
      ) : null}

      {emptyNearbyLive ? (
        <View
          style={{
            borderRadius: 18,
            backgroundColor: "#fafafa",
            padding: Spacing.lg,
            marginBottom: Spacing.lg,
            borderWidth: 1,
            borderColor: "#eee",
            gap: Spacing.md,
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: "700" }}>{t("consumerHome.emptyNearbyTitle")}</Text>
          <Text style={{ opacity: 0.72, lineHeight: 22 }}>{t("consumerHome.emptyNearbyBody")}</Text>
          <Pressable
            onPress={() => router.push("/(tabs)/settings")}
            style={{
              paddingVertical: Spacing.sm,
              paddingHorizontal: Spacing.md,
              borderRadius: 12,
              backgroundColor: "#111",
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{t("consumerHome.ctaWidenRadius")}</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowAllLiveDeals(true)}
            style={{
              paddingVertical: Spacing.sm,
              paddingHorizontal: Spacing.md,
              borderRadius: 12,
              backgroundColor: "#e8e8e8",
              alignSelf: "flex-start",
            }}
          >
            <Text style={{ fontWeight: "700" }}>{t("consumerHome.ctaViewAllDeals")}</Text>
          </Pressable>
          <Text style={{ fontSize: 13, opacity: 0.6, lineHeight: 20 }}>{t("consumerHome.ctaFavoriteHint")}</Text>
        </View>
      ) : loadingDeals ? (
        <LoadingSkeleton rows={2} />
      ) : liveDealsDisplay.length === 0 ? (
        <EmptyState title={t("consumerHome.emptyLiveTitle")} message={t("consumerHome.emptyLiveBody")} />
      ) : (
        liveDealsDisplay.map((item) => {
          const coords = bizCoords(item.businesses);
          const distanceLabel =
            userGeo && coords
              ? t("dealsBrowse.distanceAwayMiles", {
                  distance: haversineMiles(userGeo.lat, userGeo.lng, coords.lat, coords.lng).toFixed(1),
                })
              : undefined;
          const st = dealStatusForUser(item.id, userClaimsByDeal, nowTick);
          return (
            <DealCardPoster
              key={item.id}
              title={item.title ?? t("dealDetail.dealFallback")}
              description={item.description}
              businessName={item.businesses?.name ?? t("dealDetail.localBusiness")}
              distanceLabel={distanceLabel}
              posterUrl={resolveDealPosterDisplayUri(item.poster_url, item.poster_storage_path)}
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
              dealStatus={st}
              showLiveCountdown={st === "live"}
            />
          );
        })
      )}

      {favoriteBusinessIds.length > 0 ? (
        <View
          style={{
            marginBottom: Spacing.lg,
            ...(favoritesOnly
              ? {
                  backgroundColor: "#fffafa",
                  borderRadius: 16,
                  padding: Spacing.md,
                  borderWidth: 1,
                  borderColor: "#fce7f3",
                }
              : {}),
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: "700", opacity: 0.55, marginBottom: Spacing.sm }}>
            {t("consumerHome.favoritesStripTitle")}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
            {favoriteBusinessIds.map((fid) => {
              const b = businesses.find((x) => x.id === fid);
              if (!b) return null;
              return (
                <Pressable
                  key={fid}
                  onPress={() => router.push(`/business/${fid}` as Href)}
                  style={{
                    paddingVertical: Spacing.sm,
                    paddingHorizontal: Spacing.md,
                    borderRadius: 16,
                    backgroundColor: "#fff",
                    borderWidth: 1,
                    borderColor: "#eee",
                    maxWidth: 160,
                  }}
                >
                  <Text numberOfLines={2} style={{ fontWeight: "700", fontSize: 14 }}>
                    {b.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <View
        style={{
          marginTop: Spacing.md,
          paddingTop: Spacing.lg,
          borderTopWidth: 1,
          borderTopColor: "#eee",
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "800", marginBottom: Spacing.sm }}>{t("consumerHome.nearbyBusinesses")}</Text>
      </View>
    </View>
  );

  if (loadingBiz && businesses.length === 0) {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
        {listHeader}
        <LoadingSkeleton rows={4} />
      </View>
    );
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <FlatList
        style={{ flex: 1 }}
        data={businessesDisplay}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={listHeader}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
        renderItem={({ item }) => {
          const la = typeof item.latitude === "number" ? item.latitude : item.latitude != null ? Number(item.latitude) : NaN;
          const ln = typeof item.longitude === "number" ? item.longitude : item.longitude != null ? Number(item.longitude) : NaN;
          const distanceLabel =
            userGeo && Number.isFinite(la) && Number.isFinite(ln)
              ? t("dealsBrowse.distanceAwayMiles", {
                  distance: haversineMiles(userGeo.lat, userGeo.lng, la, ln).toFixed(1),
                })
              : undefined;
          return (
            <BusinessRowCard
              name={item.name}
              address={item.location}
              hasLiveDeal={liveDealIds.has(item.id)}
              isFavorite={favoriteBusinessIds.includes(item.id)}
              distanceLabel={distanceLabel}
              onPress={() => router.push(`/business/${item.id}` as Href)}
              onToggleFavorite={() => void toggleFavorite(item.id)}
            />
          );
        }}
        ListEmptyComponent={
          favoritesOnly ? (
            <EmptyState title={t("favorites.emptyTitle")} message={t("favorites.emptyMessage")} />
          ) : (
            <EmptyState title={t("consumerHome.emptyBusinessesTitle")} message={t("consumerHome.emptyBusinessesBody")} />
          )
        }
      />

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
