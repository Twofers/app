import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
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
import { collectGeocodeHints, dealMatchesNearHints, dealMatchesSearch } from "../../lib/deals-discovery-filters";
import { haversineKm } from "../../lib/geo";

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

function bizCoords(b: Deal["businesses"]): { lat: number; lng: number } | null {
  if (!b) return null;
  const lat = typeof b.latitude === "number" ? b.latitude : b.latitude != null ? Number(b.latitude) : NaN;
  const lng = typeof b.longitude === "number" ? b.longitude : b.longitude != null ? Number(b.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export default function HomeDeals() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { isLoggedIn, sessionEmail, userId } = useBusiness();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [nearMeHints, setNearMeHints] = useState<string[]>([]);
  const [userGeo, setUserGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [nearMeBusy, setNearMeBusy] = useState(false);
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

  const loadClaimCounts = useCallback(async (dealIds: string[]) => {
    if (dealIds.length === 0) return;
    const { data, error } = await supabase
      .from("deal_claims")
      .select("deal_id")
      .in("deal_id", dealIds);
    if (error) return;
    const counts: Record<string, number> = {};
    (data ?? []).forEach((row: { deal_id: string }) => {
      counts[row.deal_id] = (counts[row.deal_id] ?? 0) + 1;
    });
    setClaimCounts((prev) => ({ ...prev, ...counts }));
  }, []);

  const loadDeals = useCallback(async () => {
    setLoadingDeals(true);
    const { data, error } = await supabase
      .from("deals")
      .select("id,title,description,start_time,end_time,is_active,poster_url,business_id,price,max_claims,businesses(name,category,location,latitude,longitude),is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone")
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
    const filtered = raw.filter((deal) => isDealActiveNow(deal));
    setDeals(filtered);
    await loadClaimCounts(filtered.map((d) => d.id));
    setLoadingDeals(false);
  }, [loadClaimCounts]);

  const loadFavorites = useCallback(async (currentUserId: string | null) => {
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
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDeals();
      void loadFavorites(userId);
    }, [loadDeals, loadFavorites, userId]),
  );

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

  const categoryLabels = useMemo(() => {
    const labels = new Set<string>();
    deals.forEach((d) => {
      const c = d.businesses?.category?.trim();
      if (c) labels.add(c);
    });
    return Array.from(labels).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [deals]);

  useEffect(() => {
    if (selectedCategory && !categoryLabels.includes(selectedCategory)) {
      setSelectedCategory(null);
    }
  }, [categoryLabels, selectedCategory]);

  const categoryFilteredDeals = useMemo(() => {
    if (!selectedCategory) return deals;
    return deals.filter((d) => (d.businesses?.category?.trim() ?? "") === selectedCategory);
  }, [deals, selectedCategory]);

  const searchFilteredDeals = useMemo(
    () => categoryFilteredDeals.filter((d) => dealMatchesSearch(d, searchQuery)),
    [categoryFilteredDeals, searchQuery],
  );

  const filteredDeals = useMemo(() => {
    let list = searchFilteredDeals;
    const nearOn = userGeo !== null || nearMeHints.length > 0;
    if (!nearOn) return list;

    const anyCoordDeals = list.some((d) => bizCoords(d.businesses) !== null);

    if (userGeo && anyCoordDeals) {
      list = [...list];
      list.sort((a, b) => {
        const ca = bizCoords(a.businesses);
        const cb = bizCoords(b.businesses);
        const da = ca ? haversineKm(userGeo.lat, userGeo.lng, ca.lat, ca.lng) : Number.POSITIVE_INFINITY;
        const db = cb ? haversineKm(userGeo.lat, userGeo.lng, cb.lat, cb.lng) : Number.POSITIVE_INFINITY;
        return da - db;
      });
      return list;
    }

    if (nearMeHints.length > 0) {
      return list.filter((d) => dealMatchesNearHints(d, nearMeHints));
    }

    return list;
  }, [searchFilteredDeals, userGeo, nearMeHints]);

  const nearMeActive = userGeo !== null || nearMeHints.length > 0;

  async function toggleNearMeFilter() {
    if (nearMeActive) {
      setUserGeo(null);
      setNearMeHints([]);
      return;
    }
    setNearMeBusy(true);
    setBanner(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setBanner(t("dealsBrowse.nearMeDenied"));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      const places = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      const hints = collectGeocodeHints(places ?? []);
      setNearMeHints(hints);
    } catch {
      setBanner(t("dealsBrowse.nearMeError"));
    } finally {
      setNearMeBusy(false);
    }
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>Deals</Text>
      <Text style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, opacity: 0.72, fontSize: 15 }}>
        {sessionEmail ? `Logged in: ${sessionEmail}` : "Not logged in"}
      </Text>

      {banner ? <Banner message={banner} tone="error" /> : null}

      {!loadingDeals && deals.length > 0 && categoryLabels.length === 0 ? (
        <Text
          style={{
            fontSize: 13,
            opacity: 0.62,
            lineHeight: 18,
            marginBottom: Spacing.md,
          }}
        >
          {t("dealsBrowse.categoryHint")}
        </Text>
      ) : null}

      {!loadingDeals ? (
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, flexWrap: "wrap" }}>
            <Pressable
              onPress={() => void toggleNearMeFilter()}
              disabled={nearMeBusy}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: Spacing.sm,
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                borderRadius: 20,
                backgroundColor: nearMeActive ? "#111" : "#ececec",
                opacity: nearMeBusy ? 0.65 : 1,
              }}
            >
              {nearMeBusy ? <ActivityIndicator size="small" color={nearMeActive ? "#fff" : "#111"} /> : null}
              <Text
                style={{
                  fontWeight: "600",
                  fontSize: 14,
                  color: nearMeActive ? "#fff" : "#333",
                }}
              >
                {nearMeActive ? t("dealsBrowse.nearMeActive") : t("dealsBrowse.nearMe")}
              </Text>
            </Pressable>
            {nearMeActive ? (
              <Text style={{ fontSize: 12, opacity: 0.55, flex: 1, minWidth: 120 }} numberOfLines={2}>
                {nearMeHints.length > 0 ? t("dealsBrowse.nearMeHelp") : t("dealsBrowse.nearMeCoordsOnly")}
              </Text>
            ) : (
              <Text style={{ fontSize: 12, opacity: 0.55, flex: 1, minWidth: 120 }} numberOfLines={2}>
                {t("dealsBrowse.nearMeCaption")}
              </Text>
            )}
          </View>
        </View>
      ) : null}

      {!loadingDeals && categoryLabels.length > 0 ? (
        <View style={{ marginBottom: Spacing.md }}>
          <Text style={{ fontSize: 13, fontWeight: "600", opacity: 0.55, marginBottom: Spacing.sm }}>
            {t("dealsBrowse.categoriesHeading")}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: "row", flexWrap: "nowrap", gap: Spacing.sm, paddingRight: Spacing.lg }}
          >
            <Pressable
              onPress={() => setSelectedCategory(null)}
              style={{
                paddingVertical: Spacing.sm,
                paddingHorizontal: Spacing.md,
                borderRadius: 20,
                backgroundColor: selectedCategory == null ? "#111" : "#ececec",
              }}
            >
              <Text
                style={{
                  fontWeight: "600",
                  fontSize: 14,
                  color: selectedCategory == null ? "#fff" : "#333",
                }}
              >
                {t("dealsBrowse.filterAll")}
              </Text>
            </Pressable>
            {categoryLabels.map((label) => {
              const active = selectedCategory === label;
              return (
                <Pressable
                  key={label}
                  onPress={() => setSelectedCategory(active ? null : label)}
                  style={{
                    paddingVertical: Spacing.sm,
                    paddingHorizontal: Spacing.md,
                    borderRadius: 20,
                    backgroundColor: active ? "#111" : "#ececec",
                    maxWidth: 220,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontWeight: "600",
                      fontSize: 14,
                      color: active ? "#fff" : "#333",
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {loadingDeals ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filteredDeals}
          keyExtractor={(d) => d.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
          renderItem={({ item }) => {
            const coords = bizCoords(item.businesses);
            const distanceLabel =
              userGeo && coords
                ? t("dealsBrowse.distanceAway", {
                    distance: haversineKm(userGeo.lat, userGeo.lng, coords.lat, coords.lng).toFixed(1),
                  })
                : undefined;
            return (
              <DealCardPoster
                title={item.title ?? "Deal"}
                description={item.description}
                businessName={item.businesses?.name ?? "Local business"}
                distanceLabel={distanceLabel}
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
            );
          }}
          ListEmptyComponent={
            deals.length === 0 ? (
              <EmptyState
                title={t("dealsBrowse.emptyTitle")}
                message={t("dealsBrowse.emptyMessage")}
              />
            ) : nearMeHints.length > 0 && filteredDeals.length === 0 ? (
              <EmptyState
                title={t("dealsBrowse.emptyNearMeTitle")}
                message={t("dealsBrowse.emptyNearMeMessage")}
              />
            ) : searchQuery.trim().length > 0 ? (
              <EmptyState
                title={t("dealsBrowse.emptySearchTitle")}
                message={t("dealsBrowse.emptySearchMessage")}
              />
            ) : (
              <EmptyState
                title={t("dealsBrowse.emptyFilterTitle")}
                message={t("dealsBrowse.emptyFilterMessage")}
              />
            )
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
