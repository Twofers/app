import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import Animated, { useSharedValue, withTiming, useAnimatedStyle } from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, Radii, Shadows } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { claimDeal } from "@/lib/functions";
import { syncConsumerDealNotifications } from "@/lib/notifications";
import { isDealActiveNow } from "@/lib/deal-time";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Banner } from "@/components/ui/banner";
import { QrModal } from "@/components/qr-modal";
import { BusinessRowCard } from "@/components/business-row-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { useBusiness } from "@/hooks/use-business";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { dealMatchesSearch } from "@/lib/deals-discovery-filters";
import { haversineMiles } from "@/lib/geo";
import { translateFunctionErrorMessage } from "@/lib/i18n/function-errors";
import { trackAppAnalyticsEvent } from "@/lib/app-analytics";
import { getConsumerPreferences, setLastKnownConsumerCoords } from "@/lib/consumer-preferences";
import { syncConsumerLocationToServer } from "@/lib/sync-consumer-prefs";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { logPostgrestError } from "@/lib/supabase-client-log";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import type { ConsumerDealStatusKey } from "@/components/deal-status-pill";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DEFAULT_CLAIM_GRACE_MINUTES, isPastClaimRedeemDeadline } from "@/lib/claim-redeem-deadline";
import { collectBusinessesPageByPage } from "@/lib/businesses-fetch";
import { MIN_FEED_REFRESH_MS } from "@/constants/timing";

/** Skip redundant home-tab Supabase loads when switching tabs back quickly; pull-to-refresh always reloads. */
const MIN_FEED_FOCUS_REFRESH_MS = MIN_FEED_REFRESH_MS;
type Deal = {
  id: string;
  title: string | null;
  description: string | null;
  title_es: string | null;
  title_ko: string | null;
  description_es: string | null;
  description_ko: string | null;
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

function localizedTitle(deal: Deal, lang: string): string {
  const l = lang.split("-")[0]?.toLowerCase() ?? "en";
  if (l === "es" && deal.title_es) return deal.title_es;
  if (l === "ko" && deal.title_ko) return deal.title_ko;
  return deal.title ?? "";
}

function localizedDescription(deal: Deal, lang: string): string {
  const l = lang.split("-")[0]?.toLowerCase() ?? "en";
  if (l === "es" && deal.description_es) return deal.description_es;
  if (l === "ko" && deal.description_ko) return deal.description_ko;
  return deal.description ?? "";
}

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
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function dealStatusForUser(
  dealId: string,
  map: Map<string, { redeemed_at: string | null; expires_at: string; grace_period_minutes: number | null }>,
  now: number,
): ConsumerDealStatusKey {
  const row = map.get(dealId);
  if (!row) return "live";
  if (row.redeemed_at) return "redeemed";
  const g = row.grace_period_minutes ?? DEFAULT_CLAIM_GRACE_MINUTES;
  if (isPastClaimRedeemDeadline(row.expires_at, now, g)) return "expired";
  return "claimed";
}

function classifyClaimBlockReason(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already have an active claim")) return "active_app_wide_claim";
  if (m.includes("once per business per local day") && m.includes("redeemable")) return "business_daily_limit";
  if (m.includes("once per business per day")) return "business_daily_limit"; // legacy fallback
  if (m.includes("active claim from this business")) return "active_business_claim";
  if (m.includes("active claim for this deal")) return "duplicate_deal_claim";
  if (m.includes("reached its claim limit") || m.includes("sold out")) return "deal_sold_out";
  if (m.includes("claiming has closed") || m.includes("expired")) return "deal_closed";
  return "unknown";
}

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const isFocused = useIsFocused();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { height: windowHeight } = useWindowDimensions();
  const { isLoggedIn, userId } = useBusiness();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const mapClaimError = useCallback((raw: string) => translateFunctionErrorMessage(raw, t), [t]);

  const [deals, setDeals] = useState<Deal[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [userGeo, setUserGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [qrShortCode, setQrShortCode] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [claimSuccessToastNonce, setClaimSuccessToastNonce] = useState(0);
  const [claimingDealId, setClaimingDealId] = useState<string | null>(null);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [refreshingFeed, setRefreshingFeed] = useState(false);
  const [lastClaimDealId, setLastClaimDealId] = useState<string | null>(null);
  const [favoriteBusinessIds, setFavoriteBusinessIds] = useState<string[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [loadingBiz, setLoadingBiz] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [claimStatus, setClaimStatus] = useState<Record<string, { message: string; tone: "success" | "error" | "info" }>>({});
  const [userClaimsByDeal, setUserClaimsByDeal] = useState<
    Map<string, { redeemed_at: string | null; expires_at: string; grace_period_minutes: number | null }>
  >(() => new Map());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showAllLiveDeals, setShowAllLiveDeals] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(3);
  const [feedSegment, setFeedSegment] = useState<"deals" | "shops">("deals");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const dealsRef = useRef(deals);
  dealsRef.current = deals;
  const lastFeedFocusHydrateAtRef = useRef(0);
  const lastFeedFocusHydrateUserIdRef = useRef<string | null | undefined>(undefined);
  const dealsFade = useSharedValue(0);
  const dealsFadeStyle = useAnimatedStyle(() => ({ opacity: dealsFade.value }));

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const loadUserClaims = useCallback(
    async (dealIds: string[]) => {
      if (!userId || dealIds.length === 0) {
        setUserClaimsByDeal(new Map());
        return;
      }
      const { data, error } = await supabase
        .from("deal_claims")
        .select("deal_id,redeemed_at,expires_at,created_at,grace_period_minutes")
        .eq("user_id", userId)
        .in("deal_id", dealIds)
        .order("created_at", { ascending: false });
      if (error) {
        setUserClaimsByDeal(new Map());
        return;
      }
      const m = new Map<
        string,
        { redeemed_at: string | null; expires_at: string; grace_period_minutes: number | null }
      >();
      for (const row of data ?? []) {
        const did = row.deal_id as string;
        if (!m.has(did)) {
          m.set(did, {
            redeemed_at: row.redeemed_at as string | null,
            expires_at: row.expires_at as string,
            grace_period_minutes: (row.grace_period_minutes as number | null) ?? null,
          });
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
        "id,title,description,title_es,title_ko,description_es,description_ko,start_time,end_time,is_active,poster_url,poster_storage_path,business_id,price,max_claims,businesses(name,category,location,latitude,longitude),is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone",
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
    await loadUserClaims(filtered.map((d) => d.id));
    setLoadingDeals(false);
  }, [loadUserClaims, t]);

  const loadBusinesses = useCallback(async () => {
    setLoadingBiz(true);
    try {
      const rows = await collectBusinessesPageByPage(async ({ from, to }) => {
        return await supabase
          .from("businesses")
          .select("id,name,location,latitude,longitude")
          .order("name", { ascending: true })
          .range(from, to);
      });
      setBusinesses(rows as BusinessRow[]);
    } catch (error) {
      const err = error instanceof Error ? { message: error.message } : { message: "Unknown businesses load error" };
      logPostgrestError("home screen businesses", err);
      setBanner(t("consumerHome.loadBusinessesError"));
      setBusinesses([]);
    }
    setLoadingBiz(false);
  }, [t]);

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
      void syncConsumerLocationToServer(userId, coords.lat, coords.lng);
    } else {
      setUserGeo(null);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      const uid = userId ?? null;
      const now = Date.now();
      const userChanged = lastFeedFocusHydrateUserIdRef.current !== uid;
      const cooldownActive =
        lastFeedFocusHydrateAtRef.current !== 0 &&
        now - lastFeedFocusHydrateAtRef.current < MIN_FEED_FOCUS_REFRESH_MS;

      if (cooldownActive && !userChanged) {
        return;
      }

      lastFeedFocusHydrateAtRef.current = now;
      lastFeedFocusHydrateUserIdRef.current = uid;

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

  const toggleFavorite = useCallback(
    async (businessId: string) => {
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
          setBanner(t("consumerHome.errFavoriteToggle"));
        }
      } else {
        const { error } = await supabase.from("favorites").insert({ user_id: userId, business_id: businessId });
        if (error) {
          setFavoriteBusinessIds(favoriteBusinessIds);
          setBanner(t("consumerHome.errFavoriteToggle"));
        }
      }
    },
    [userId, favoriteBusinessIds, t],
  );

  const doClaim = useCallback(
    async (dealId: string) => {
      try {
        if (!isLoggedIn) {
          setBanner(t("dealDetail.errLoginClaim"));
          return;
        }
        if (claimingDealId) return;
        setClaimingDealId(dealId);
        setClaimStatus((prev) => ({ ...prev, [dealId]: { message: t("dealsBrowse.statusClaiming"), tone: "info" } }));

        const out = await claimDeal(dealId);
        const businessIdForDeal = dealsRef.current.find((d) => d.id === dealId)?.business_id ?? null;
        if (out.claim_id) setClaimSuccessToastNonce((n) => n + 1);
        trackAppAnalyticsEvent({
          event_name: "deal_claimed",
          claim_id: out.claim_id ?? null,
          deal_id: dealId,
          business_id: businessIdForDeal,
        });

        setQrToken(out.token);
        setQrExpires(out.expires_at);
        setQrShortCode(out.short_code ?? null);
        setLastClaimDealId(dealId);
        setQrVisible(true);
        setClaimStatus((prev) => ({
          ...prev,
          [dealId]: { message: t("dealsBrowse.statusClaimedShowQr"), tone: "success" },
        }));
        await loadUserClaims(dealsRef.current.map((d) => d.id));
      } catch (e: unknown) {
        const msg =
          typeof (e as { message?: string })?.message === "string"
            ? (e as { message: string }).message
            : typeof e === "string"
              ? e
              : JSON.stringify(e, null, 2);
        const businessIdForDeal = dealsRef.current.find((d) => d.id === dealId)?.business_id ?? null;
        trackAppAnalyticsEvent({
          event_name: "claim_blocked",
          deal_id: dealId,
          business_id: businessIdForDeal,
          context: { reason: classifyClaimBlockReason(msg) },
        });
        const mappedClaimErr = mapClaimError(msg);
        setBanner(mappedClaimErr);
        setClaimStatus((prev) => {
          const next = { ...prev };
          delete next[dealId];
          return next;
        });
      } finally {
        setClaimingDealId(null);
      }
    },
    [isLoggedIn, claimingDealId, loadUserClaims, mapClaimError, t],
  );

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
      setQrShortCode(out.short_code ?? null);
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
    return [...list].sort((a, b) => {
      const aFav = favoriteBusinessIds.includes(a.business_id) ? 0 : 1;
      const bFav = favoriteBusinessIds.includes(b.business_id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      if (userGeo) {
        const ca = bizCoords(a.businesses);
        const cb = bizCoords(b.businesses);
        const da = ca ? haversineMiles(userGeo.lat, userGeo.lng, ca.lat, ca.lng) : Number.POSITIVE_INFINITY;
        const db = cb ? haversineMiles(userGeo.lat, userGeo.lng, cb.lat, cb.lng) : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return new Date(a.end_time).getTime() - new Date(b.end_time).getTime();
    });
  }, [searchFilteredDeals, dealsWithinRadius, showAllLiveDeals, favoritesOnly, favoriteBusinessIds, userGeo]);

  // MVP impressions tracking: count deals whenever the visible list changes.
  // This is an approximation of "shown" but stays simple/reliable for MVP.
  useEffect(() => {
    if (loadingDeals) return;
    for (const d of liveDealsDisplay) {
      trackAppAnalyticsEvent({
        event_name: "deal_viewed",
        deal_id: d.id,
        business_id: d.business_id,
        context: { source: "list" },
      });
    }
  }, [loadingDeals, liveDealsDisplay]);

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

  const shopsForList = useMemo(() => {
    let list = businessesDisplay;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) || (b.location ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [businessesDisplay, searchQuery]);

  const liveDealIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of dealsWithinRadius) {
      s.add(d.business_id);
    }
    return s;
  }, [dealsWithinRadius]);

  const emptyNearbyLive =
    !loadingDeals && liveDealsDisplay.length === 0 && searchFilteredDeals.length > 0 && !showAllLiveDeals;

  const showDealsSkeleton = loadingDeals && deals.length === 0;
  const wasShowingDealsSkeleton = useRef(showDealsSkeleton);
  useEffect(() => {
    if (wasShowingDealsSkeleton.current && !showDealsSkeleton) {
      dealsFade.value = 0;
      dealsFade.value = withTiming(1, { duration: 220 });
    }
    wasShowingDealsSkeleton.current = showDealsSkeleton;
  }, [dealsFade, showDealsSkeleton]);

  const onPullToRefresh = useCallback(async () => {
    if (refreshingFeed) return;
    setRefreshingFeed(true);
    try {
      await Promise.all([loadDeals(), loadBusinesses(), loadFavorites(userId), hydrateLocationFromPrefs()]);
      lastFeedFocusHydrateAtRef.current = Date.now();
      lastFeedFocusHydrateUserIdRef.current = userId ?? null;
    } finally {
      setRefreshingFeed(false);
    }
  }, [refreshingFeed, loadDeals, loadBusinesses, loadFavorites, userId, hydrateLocationFromPrefs]);

  const heroCardHeight = Math.min(520, Math.max(340, Math.round(windowHeight * 0.5)));
  const heroImageHeight = Math.round(heroCardHeight * 0.57);

  const formatTimeLeft = useCallback(
    (endTimeIso: string) => {
      const deltaMs = new Date(endTimeIso).getTime() - nowTick;
      if (!Number.isFinite(deltaMs) || deltaMs <= 0) return t("dealDetail.expired");
      const totalMin = Math.max(1, Math.floor(deltaMs / 60_000));
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      if (h > 0) return t("consumerHome.timeLeftHM", { h, m });
      return t("consumerHome.timeLeftM", { m });
    },
    [nowTick, t],
  );

  const renderDealItem = useCallback(
    ({ item }: { item: Deal }) => {
      const coords = bizCoords(item.businesses);
      const distanceLabel =
        userGeo && coords
          ? t("dealsBrowse.distanceAwayMiles", {
              distance: haversineMiles(userGeo.lat, userGeo.lng, coords.lat, coords.lng).toFixed(1),
            })
          : undefined;
      const st = dealStatusForUser(item.id, userClaimsByDeal, nowTick);
      const offerText = localizedTitle(item, i18n.language) || t("dealDetail.dealFallback");
      const bogoText = /bogo|buy one get one/i.test(offerText) ? offerText : `BOGO: ${offerText}`;
      return (
        <View
          style={{
            marginBottom: Spacing.xl,
            borderRadius: Radii.card,
            backgroundColor: theme.surface,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: theme.border,
            ...Shadows.soft,
          }}
        >
          <Pressable onPress={() => router.push(`/deal/${item.id}`)} accessibilityRole="button">
            <Image
              source={{
                uri:
                  resolveDealPosterDisplayUri(item.poster_url, item.poster_storage_path) ??
                  "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=60",
              }}
              style={{ width: "100%", height: heroImageHeight }}
              contentFit="cover"
            />
          </Pressable>
          <View style={{ minHeight: heroCardHeight - heroImageHeight, padding: Spacing.lg, gap: Spacing.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: Spacing.sm }}>
              <Text style={{ fontSize: 20, fontWeight: "800", flex: 1, color: theme.text }} numberOfLines={2}>
                {item.businesses?.name ?? t("dealDetail.localBusiness")}
              </Text>
              <Pressable
                onPress={() => void toggleFavorite(item.business_id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
              >
                <MaterialIcons
                  name={favoriteBusinessIds.includes(item.business_id) ? "favorite" : "favorite-border"}
                  size={24}
                  color={favoriteBusinessIds.includes(item.business_id) ? "#e0245e" : theme.icon}
                />
              </Pressable>
            </View>
            <Text style={{ fontSize: 22, lineHeight: 30, fontWeight: "900", color: theme.text }} numberOfLines={2}>
              {bogoText}
            </Text>
            <Text numberOfLines={2} style={{ fontSize: 15, color: theme.mutedText, lineHeight: 22 }}>
              {localizedDescription(item, i18n.language) || t("consumerHome.tagline")}
            </Text>
            <View style={{ marginTop: "auto", flexDirection: "row", alignItems: "center", gap: Spacing.md, flexWrap: "wrap" }}>
              {distanceLabel ? (
                <Text style={{ color: theme.primary, fontWeight: "700", fontSize: 14 }}>{distanceLabel}</Text>
              ) : null}
              <Text style={{ color: theme.primary, fontWeight: "700", fontSize: 14 }}>
                {st === "live" ? formatTimeLeft(item.end_time) : t("dealDetail.expired")}
              </Text>
            </View>
            {claimStatus[item.id]?.message ? (
              <Text style={{ marginTop: Spacing.sm, fontSize: 13, lineHeight: 18, color: theme.mutedText }}>
                {claimStatus[item.id]?.message}
              </Text>
            ) : null}
            <View style={{ marginTop: Spacing.sm }}>
              <PrimaryButton
                title={claimingDealId === item.id ? t("dealsBrowse.statusClaiming") : t("dealDetail.claimButton")}
                onPress={() => void doClaim(item.id)}
                disabled={claimingDealId === item.id || st !== "live"}
              />
            </View>
            <Pressable
              onPress={() => router.push(`/business/${item.business_id}` as Href)}
              accessibilityRole="button"
              accessibilityLabel={t("consumerHome.shopInfoLink")}
              style={{ paddingVertical: Spacing.sm, alignItems: "center" }}
            >
              <Text style={{ color: theme.primary, fontWeight: "700", fontSize: 15 }}>{t("consumerHome.shopInfoLink")}</Text>
            </Pressable>
          </View>
        </View>
      );
    },
    [
      t,
      router,
      userGeo,
      userClaimsByDeal,
      nowTick,
      favoriteBusinessIds,
      theme,
      heroImageHeight,
      heroCardHeight,
      toggleFavorite,
      formatTimeLeft,
      claimStatus,
      claimingDealId,
      doClaim,
    ],
  );

  const renderFeedItem = useCallback(
    ({ item }: { item: Deal | BusinessRow }) => {
      if (feedSegment === "deals") {
        return renderDealItem({ item: item as Deal });
      }
      const b = item as BusinessRow;
      const la = typeof b.latitude === "number" ? b.latitude : b.latitude != null ? Number(b.latitude) : NaN;
      const ln = typeof b.longitude === "number" ? b.longitude : b.longitude != null ? Number(b.longitude) : NaN;
      const distanceLabel =
        userGeo && Number.isFinite(la) && Number.isFinite(ln)
          ? t("dealsBrowse.distanceAwayMiles", {
              distance: haversineMiles(userGeo.lat, userGeo.lng, la, ln).toFixed(1),
            })
          : undefined;
      return (
        <BusinessRowCard
          name={b.name}
          address={b.location}
          hasLiveDeal={liveDealIds.has(b.id)}
          isFavorite={favoriteBusinessIds.includes(b.id)}
          distanceLabel={distanceLabel}
          onPress={() => router.push(`/business/${b.id}` as Href)}
          onToggleFavorite={() => void toggleFavorite(b.id)}
        />
      );
    },
    [feedSegment, renderDealItem, userGeo, t, liveDealIds, favoriteBusinessIds, router, toggleFavorite],
  );

  const listHeader = useMemo(
    () => (
      <View style={{ marginBottom: Spacing.md }}>
        <ScreenHeader title="TWOFER" subtitle={t("consumerHome.tagline")} />

        <View style={{ marginTop: Spacing.sm, marginBottom: Spacing.md, gap: Spacing.sm }}>
          <View
            style={{
              borderWidth: 1.2,
              borderColor: theme.border,
              borderRadius: Radii.lg,
              paddingVertical: Spacing.sm + 1,
              paddingHorizontal: Spacing.md,
              backgroundColor: theme.surface,
              flexDirection: "row",
              alignItems: "center",
              gap: Spacing.sm,
            }}
          >
            <MaterialIcons name="search" size={22} color={theme.mutedText} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t("dealsBrowse.searchPlaceholder")}
              placeholderTextColor={theme.mutedText}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              style={{ flex: 1, fontSize: 16, color: theme.text, paddingVertical: 2 }}
            />
          </View>
          <Pressable
            onPress={() => router.push("/(tabs)/settings" as Href)}
            accessibilityRole="button"
            style={{
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: Radii.pill,
              paddingVertical: Spacing.sm,
              paddingHorizontal: Spacing.md,
              backgroundColor: theme.surfaceMuted,
              gap: Spacing.xs,
            }}
          >
            <MaterialIcons name="place" size={18} color={theme.primary} />
            <Text style={{ fontSize: 13, fontWeight: "700", color: theme.text }} numberOfLines={1}>
              {userGeo
                ? t("consumerHome.locationChipWithRadius", { miles: radiusMiles })
                : t("consumerHome.locationChipNoLocation")}
            </Text>
          </Pressable>
        </View>

        <View
          style={{
            flexDirection: "row",
            borderRadius: Radii.pill,
            backgroundColor: theme.surfaceMuted,
            padding: 4,
            marginBottom: Spacing.md,
            gap: 4,
          }}
        >
          <Pressable
            onPress={() => setFeedSegment("deals")}
            accessibilityRole="button"
            accessibilityState={{ selected: feedSegment === "deals" }}
            style={{
              flex: 1,
              paddingVertical: Spacing.sm + 2,
              borderRadius: Radii.md,
              backgroundColor: feedSegment === "deals" ? theme.primary : "transparent",
            }}
          >
            <Text
              style={{
                textAlign: "center",
                fontWeight: "800",
                fontSize: 15,
                color: feedSegment === "deals" ? theme.primaryText : theme.text,
              }}
            >
              {t("consumerHome.segmentDeals")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFeedSegment("shops")}
            accessibilityRole="button"
            accessibilityState={{ selected: feedSegment === "shops" }}
            style={{
              flex: 1,
              paddingVertical: Spacing.sm + 2,
              borderRadius: Radii.md,
              backgroundColor: feedSegment === "shops" ? theme.primary : "transparent",
            }}
          >
            <Text
              style={{
                textAlign: "center",
                fontWeight: "800",
                fontSize: 15,
                color: feedSegment === "shops" ? theme.primaryText : theme.text,
              }}
            >
              {t("consumerHome.segmentShops")}
            </Text>
          </Pressable>
        </View>

        {feedSegment === "shops" ? (
          <Text style={{ marginBottom: Spacing.md, fontSize: 15, opacity: 0.62, lineHeight: 22, color: theme.text }}>
            {t("consumerHome.shopsSubtitle")}
          </Text>
        ) : null}

        {feedSegment === "deals" ? (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: Spacing.md,
                gap: Spacing.md,
              }}
            >
              <Text style={{ fontSize: 22, fontWeight: "800", flex: 1, color: theme.text }}>
                {t("consumerHome.liveNearYou")}
              </Text>
              <Pressable
                onPress={() => setFavoritesOnly(!favoritesOnly)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityState={{ selected: favoritesOnly }}
                accessibilityLabel={favoritesOnly ? t("consumerHome.favoritesOn") : t("consumerHome.favoritesOff")}
                style={({ pressed }) => ({
                  padding: Spacing.sm,
                  borderRadius: 22,
                  backgroundColor: favoritesOnly
                    ? colorScheme === "dark"
                      ? "rgba(236,72,153,0.2)"
                      : "rgba(224,36,94,0.12)"
                    : pressed
                      ? theme.surfaceMuted
                      : "transparent",
                })}
              >
                <MaterialIcons
                  name={favoritesOnly ? "favorite" : "favorite-border"}
                  size={26}
                  color={favoritesOnly ? "#e0245e" : theme.mutedText}
                />
              </Pressable>
            </View>

            {favoritesOnly ? (
              <Text style={{ fontSize: 13, opacity: 0.55, marginBottom: Spacing.md, lineHeight: 18, color: theme.text }}>
                {t("consumerHome.favoritesOnlyActive")}
              </Text>
            ) : null}

            {emptyNearbyLive ? (
              <View
                style={{
                  borderRadius: Radii.card,
                  backgroundColor: theme.surface,
                  padding: Spacing.xxxl,
                  marginBottom: Spacing.xxxl,
                  borderWidth: 1,
                  borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.38)" : "rgba(255,159,28,0.22)",
                  gap: Spacing.md,
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.22)" : "rgba(255,159,28,0.14)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 2,
                  }}
                >
                  <Image
                    source={require("../../assets/images/splash-icon.png")}
                    style={{ width: 30, height: 30, opacity: 0.95 }}
                    contentFit="contain"
                  />
                </View>
                <Text style={{ fontSize: 17, fontWeight: "700", color: theme.text }}>{t("consumerHome.emptyNearbyTitle")}</Text>
                <Text style={{ opacity: 0.72, lineHeight: 22, textAlign: "center", color: theme.text }}>
                  {t("consumerHome.emptyNearbyBodySub")}
                </Text>
                <Text style={{ fontSize: 13, color: theme.primary, opacity: 0.95, lineHeight: 20, textAlign: "center" }}>
                  {t("consumerHome.emptyNearbyPenguinHint")}
                </Text>
                <PrimaryButton
                  title={t("consumerHome.ctaWidenRadius")}
                  onPress={() => router.push("/(tabs)/settings")}
                  style={{ alignSelf: "stretch" }}
                />
                <SecondaryButton
                  title={t("consumerHome.ctaViewAllDeals")}
                  onPress={() => setShowAllLiveDeals(true)}
                  style={{ alignSelf: "stretch" }}
                />
                <Text style={{ fontSize: 13, opacity: 0.6, lineHeight: 20, color: theme.text }}>
                  {t("consumerHome.ctaFavoriteHint")}
                </Text>
              </View>
            ) : showDealsSkeleton ? (
              <LoadingSkeleton rows={2} />
            ) : null}
          </>
        ) : (
          <View style={{ marginBottom: Spacing.md, paddingTop: Spacing.xs }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: theme.text }}>{t("consumerHome.nearbyBusinesses")}</Text>
          </View>
        )}

        {favoriteBusinessIds.length > 0 ? (
          <View
            style={{
              marginBottom: Spacing.lg,
              ...(favoritesOnly
                ? {
                    backgroundColor: colorScheme === "dark" ? "rgba(236,72,153,0.12)" : "#fffafa",
                    borderRadius: Radii.card,
                    padding: Spacing.md,
                    borderWidth: 1,
                    borderColor: colorScheme === "dark" ? "rgba(244,114,182,0.32)" : "#fce7f3",
                  }
                : {}),
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", opacity: 0.55, marginBottom: Spacing.sm, color: theme.text }}>
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
                      borderRadius: Radii.md,
                      backgroundColor: theme.surface,
                      borderWidth: 1,
                      borderColor: theme.border,
                      maxWidth: 160,
                    }}
                  >
                    <Text numberOfLines={2} style={{ fontWeight: "700", fontSize: 14, color: theme.text }}>
                      {b.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </View>
    ),
    [
      t,
      searchQuery,
      router,
      userGeo,
      radiusMiles,
      favoritesOnly,
      emptyNearbyLive,
      showDealsSkeleton,
      feedSegment,
      favoriteBusinessIds,
      businesses,
      colorScheme,
      theme,
    ],
  );

  return (
    <KeyboardScreen>
    <View pointerEvents={isFocused ? "auto" : "none"} style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, backgroundColor: theme.background }}>
      {banner ? <Banner message={banner} tone="error" onRetry={() => { setBanner(null); void onPullToRefresh(); }} /> : null}
      <Animated.View style={[{ flex: 1 }, feedSegment === "deals" ? dealsFadeStyle : undefined]}>
        <FlatList<Deal | BusinessRow>
          style={{ flex: 1 }}
          data={feedSegment === "deals" ? liveDealsDisplay : shopsForList}
          extraData={{ feedSegment, dealsLen: liveDealsDisplay.length, shopsLen: shopsForList.length }}
          keyExtractor={(row) => row.id}
          ListHeaderComponent={listHeader}
          showsVerticalScrollIndicator={false}
          {...FORM_SCROLL_KEYBOARD_PROPS}
          removeClippedSubviews={Platform.OS === "android"}
          maxToRenderPerBatch={12}
          windowSize={7}
          initialNumToRender={8}
          refreshControl={
            <RefreshControl
              refreshing={refreshingFeed}
              onRefresh={onPullToRefresh}
              tintColor={theme.primary}
              colors={[theme.primary]}
            />
          }
          contentContainerStyle={{ paddingBottom: listBottom, flexGrow: 1 }}
          renderItem={renderFeedItem}
          ListEmptyComponent={
            feedSegment === "deals"
              ? emptyNearbyLive || showDealsSkeleton
                ? null
                : (
                    <EmptyState title={t("consumerHome.emptyLiveTitle")} message={t("consumerHome.emptyLiveBody")} />
                  )
              : loadingBiz && businesses.length === 0
                ? (
                    <LoadingSkeleton rows={4} />
                  )
                : favoritesOnly
                  ? (
                      <EmptyState title={t("favorites.emptyTitle")} message={t("favorites.emptyMessage")} />
                    )
                  : (
                      <EmptyState title={t("consumerHome.emptyBusinessesTitle")} message={t("consumerHome.emptyBusinessesBody")} />
                    )
          }
        />
      </Animated.View>

      <QrModal
        visible={qrVisible}
        token={qrToken}
        expiresAt={qrExpires}
        shortCode={qrShortCode}
        successToastNonce={claimSuccessToastNonce}
        onHide={() => setQrVisible(false)}
        onRefresh={refreshQr}
        refreshing={refreshingQr}
      />
    </View>
    </KeyboardScreen>
  );
}
