import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type ViewToken,
} from "react-native";
import { Image } from "expo-image";
import Animated, { useSharedValue, withTiming, useAnimatedStyle } from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors, PrimaryTint, Radii, Shadows } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { claimDeal } from "@/lib/functions";
import { syncConsumerDealNotifications, getAlertsEnabled, setAlertsEnabled, scheduleClaimExpiryReminder } from "@/lib/notifications";
import { requestNotificationPermissionsSafe } from "@/lib/expo-notifications-support";
import { isDealActiveNow } from "@/lib/deal-time";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Banner } from "@/components/ui/banner";
import { QrModal } from "@/components/qr-modal";
import { BrandedConfirmModal } from "@/components/ui/branded-confirm-modal";
import { BusinessRowCard } from "@/components/business-row-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { ComposedAdCard } from "@/components/composed-ad-card/ComposedAdCard";
import { useBusiness } from "@/hooks/use-business";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  mergeDealsById,
  readBusinessCoordinates,
  shouldShowDealInNearbyFeed,
} from "@/lib/consumer-feed-visibility";
import { dealMatchesSearch } from "@/lib/deals-discovery-filters";
import { formatDistanceMiles, haversineMiles } from "@/lib/geo";
import { compactLocationLabel } from "@/lib/display-format";
import { translateFunctionErrorMessage } from "@/lib/i18n/function-errors";
import { trackAppAnalyticsEvent } from "@/lib/app-analytics";
import {
  getConsumerPreferences,
  setLastKnownConsumerCoords,
  setConsumerNotificationPrefs,
  setConsumerDealSortMode,
  DEFAULT_RADIUS_MILES,
  DEFAULT_DEAL_SORT_MODE,
  CONSUMER_DEAL_SORT_MODES,
  type ConsumerDealSortMode,
} from "@/lib/consumer-preferences";
import { syncConsumerLocationToServer } from "@/lib/sync-consumer-prefs";
import {
  PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE,
  registerPushTokenWithResult,
} from "@/lib/push-token";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { logPostgrestError } from "@/lib/supabase-client-log";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { getCustomerPreferredDealLocale, getDeviceDealLocale } from "@/lib/customer-deal-locale-storage";
import {
  fetchCustomerDealLocalizations,
  type CustomerDealLocalization,
} from "@/lib/customer-deal-localizations";
import {
  fetchCustomerDealPosterSpecs,
  type CustomerDealPosterSpec,
} from "@/lib/customer-deal-poster-specs";
import {
  buildLocalizedDealDisplay,
  resolveDealDisplayLocale,
  shouldUseCustomerLocalizedOfferRenderer,
} from "@/lib/localized-deal-display";
import {
  DEAL_FEED_BASE_SELECT,
  DEAL_FEED_SELECT,
  isMissingStructuredDisplayColumnError,
  type Deal,
} from "@/lib/deal-feed-schema";
import {
  isDealHiddenByRepeatPolicy,
  loadBusinessRedemptionMap,
  loadBusinessRepeatPolicies,
  type RepeatPolicyFields,
} from "@/lib/repeat-claim-visibility";
import type { ConsumerDealStatusKey } from "@/components/deal-status-pill";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { FORM_SCROLL_KEYBOARD_PROPS, KeyboardScreen } from "@/components/ui/keyboard-screen";
import { ScreenHeader } from "@/components/ui/screen-header";
import { DEFAULT_CLAIM_GRACE_MINUTES, isPastClaimRedeemDeadline } from "@/lib/claim-redeem-deadline";
import { collectBusinessesPageByPage, mergeBusinessRowsById } from "@/lib/businesses-fetch";
import { MIN_FEED_REFRESH_MS } from "@/constants/timing";
import { DemoOfferNotice } from "@/components/demo-offer-notice";
import { DEMO_OFFER_SHORT_EXPLANATION, isDemoOffer } from "@/lib/demo-content";
import { buildDefaultAdPresentationSpec } from "@/lib/ad-presentation-spec";
import { buildApprovedAdCopy, buildMerchantIdentity } from "@/lib/ad-render-content";
import { renderAuthoritativeOfferFromDeal } from "@/lib/authoritative-offer-renderer";
import {
  isAiV4SharedRendererEnabled,
  isAiV5CustomerLocaleResolutionEnabled,
  isAiV5LocalizedOfferRendererEnabled,
} from "@/lib/runtime-env";
import { supportedLocaleOrDefault } from "@/lib/supported-locales";

/** Skip redundant home-tab Supabase loads when switching tabs back quickly; pull-to-refresh always reloads. */
const MIN_FEED_FOCUS_REFRESH_MS = MIN_FEED_REFRESH_MS;
/**
 * Generous metro-wide fetch radius for the geo queries (deals AND shops).
 *  - Deals: fetched within this radius; the user's own tighter radius filter and the
 *    "show all" toggle then apply client-side over that bounded, geo-relevant set.
 *  - Shops: the Shops tab is a discovery surface and is intentionally NOT filtered to
 *    the user's tighter radius — it lists all shops in the metro, nearest first — so it
 *    uses this radius too. Bounded for scale instead of loading every business globally.
 */
const NEARBY_FETCH_MILES = 60;
function businessDetailHref(businessId: string, distanceLabel?: string | null): Href {
  const encodedId = encodeURIComponent(businessId);
  return (distanceLabel
    ? `/business/${encodedId}?distance=${encodeURIComponent(distanceLabel)}`
    : `/business/${encodedId}`) as Href;
}

type BusinessRow = {
  id: string;
  name: string;
  location: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

function dealStatusForUser(
  deal: Pick<Deal, "id" | "end_time">,
  map: Map<string, { redeemed_at: string | null; expires_at: string; grace_period_minutes: number | null }>,
  now: number,
): ConsumerDealStatusKey {
  const row = map.get(deal.id);
  if (row?.redeemed_at) return "redeemed";
  if (row) {
    const g = row.grace_period_minutes ?? DEFAULT_CLAIM_GRACE_MINUTES;
    // An unredeemed claim still inside its redeem window keeps the card "claimed".
    if (!isPastClaimRedeemDeadline(row.expires_at, now, g)) return "claimed";
    // Otherwise the prior claim lapsed. A lapsed claim does NOT consume the deal,
    // so fall through and reflect the deal's own status — a live deal stays
    // re-claimable ("live"), never "expired" just because an old claim timed out.
  }
  return new Date(deal.end_time).getTime() > now ? "live" : "expired";
}

async function fetchActiveDealsForFeed(nowIso: string, limit = 80) {
  const enriched = await supabase
    .from("deals")
    .select(DEAL_FEED_SELECT)
    .eq("is_active", true)
    .gte("end_time", nowIso)
    .order("end_time", { ascending: true })
    .limit(limit);
  if (!isMissingStructuredDisplayColumnError(enriched.error)) return enriched;

  return await supabase
    .from("deals")
    .select(DEAL_FEED_BASE_SELECT)
    .eq("is_active", true)
    .gte("end_time", nowIso)
    .order("end_time", { ascending: true })
    .limit(limit);
}

async function fetchDealsByIdsForFeed(ids: string[]) {
  const enriched = await supabase.from("deals").select(DEAL_FEED_SELECT).in("id", ids);
  if (!isMissingStructuredDisplayColumnError(enriched.error)) return enriched;
  return await supabase.from("deals").select(DEAL_FEED_BASE_SELECT).in("id", ids);
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

function messageFromThrown(value: unknown): string | null {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return null;
}

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const isFocused = useIsFocused();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { isLoggedIn, userId } = useBusiness();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const composedCustomerRendererEnabled = isAiV4SharedRendererEnabled();
  const customerLocaleResolutionEnabled = isAiV5CustomerLocaleResolutionEnabled();
  const localizedOfferRendererEnabled = isAiV5LocalizedOfferRendererEnabled();
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
  const [customerPreferredDealLocale, setCustomerPreferredDealLocaleState] = useState<string | null>(null);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [loadingBiz, setLoadingBiz] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [claimStatus, setClaimStatus] = useState<Record<string, { message: string; tone: "success" | "error" | "info" }>>({});
  const [customerDealLocalizationsByDealId, setCustomerDealLocalizationsByDealId] = useState<Map<string, CustomerDealLocalization>>(
    () => new Map(),
  );
  const [customerDealPosterSpecsByDealId, setCustomerDealPosterSpecsByDealId] = useState<Map<string, CustomerDealPosterSpec>>(
    () => new Map(),
  );
  const [userClaimsByDeal, setUserClaimsByDeal] = useState<
    Map<string, { redeemed_at: string | null; expires_at: string; grace_period_minutes: number | null }>
  >(() => new Map());
  /** Total non-canceled claims per capped deal (deal_claim_counts RPC). Empty until the RPC is deployed. */
  const [claimCountsByDeal, setClaimCountsByDeal] = useState<Map<string, number>>(() => new Map());
  /** Repeat-claim policy per business + this user's last redemption per business, used to hide
   *  deals the customer is currently restricted from. Empty maps => nothing hidden. */
  const [repeatPolicyByBusiness, setRepeatPolicyByBusiness] = useState<Map<string, RepeatPolicyFields>>(() => new Map());
  const [lastRedeemedByBusiness, setLastRedeemedByBusiness] = useState<Map<string, string>>(() => new Map());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortMode, setSortMode] = useState<ConsumerDealSortMode>(DEFAULT_DEAL_SORT_MODE);
  const [showAllLiveDeals, setShowAllLiveDeals] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState<number>(DEFAULT_RADIUS_MILES);
  const [preferredCategories, setPreferredCategories] = useState<string[]>([]);
  const [feedSegment, setFeedSegment] = useState<"deals" | "shops">("deals");
  // Branded deal-alert dialog (replaces native Alert.alert) for opt-in, denied permission, and registration retry.
  const [alertDialog, setAlertDialog] = useState<null | "consent" | "permissionDenied" | "registrationFailed">(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const deviceDealLocaleRef = useRef(getDeviceDealLocale());
  const customerPreferredDealLocaleRef = useRef<string | null>(null);
  const customerLocaleResolutionEnabledRef = useRef(customerLocaleResolutionEnabled);
  const dealsRef = useRef(deals);
  dealsRef.current = deals;
  customerPreferredDealLocaleRef.current = customerPreferredDealLocale;
  customerLocaleResolutionEnabledRef.current = customerLocaleResolutionEnabled;
  const customerDealLocalizationResolution = customerLocaleResolutionEnabled
    ? resolveDealDisplayLocale({
        customerPreferredLocale: customerPreferredDealLocale,
        appLanguage: i18n.language,
        deviceLanguage: deviceDealLocaleRef.current,
        adSourceLocale: null,
      })
    : {
        locale: supportedLocaleOrDefault(i18n.language),
        source: "app_language" as const,
        enabledLocales: [supportedLocaleOrDefault(i18n.language)],
      };
  const customerDealLocalizationLocale = customerDealLocalizationResolution.locale;
  // Keep the current segment readable inside the stable viewability callback below
  // (FlatList forbids changing onViewableItemsChanged/viewabilityConfig between renders).
  const feedSegmentRef = useRef(feedSegment);
  feedSegmentRef.current = feedSegment;
  // Per-session impression dedupe: each deal is counted at most once while the feed stays mounted.
  const viewedDealIdsRef = useRef<Set<string>>(new Set());
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 400 });
  const onViewableDealsChangedRef = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    // Only deals produce impressions; the shops segment shares this FlatList.
    if (feedSegmentRef.current !== "deals") return;
    for (const token of viewableItems) {
      if (!token.isViewable) continue;
      const deal = token.item as Deal;
      if (!deal || typeof deal.id !== "string") continue;
      if (viewedDealIdsRef.current.has(deal.id)) continue;
      viewedDealIdsRef.current.add(deal.id);
      const resolvedLocale = customerLocaleResolutionEnabledRef.current
        ? resolveDealDisplayLocale({
            customerPreferredLocale: customerPreferredDealLocaleRef.current,
            appLanguage: null,
            deviceLanguage: deviceDealLocaleRef.current,
            adSourceLocale: deal.source_locale,
          })
        : null;
      trackAppAnalyticsEvent({
        event_name: "deal_viewed",
        deal_id: deal.id,
        business_id: deal.business_id,
        context: {
          source: "list",
          customer_render_locale: resolvedLocale?.locale ?? null,
          locale_resolution_source: resolvedLocale?.source ?? null,
        },
      });
    }
  });
  const lastFeedFocusHydrateAtRef = useRef(0);
  const lastFeedFocusHydrateUserIdRef = useRef<string | null | undefined>(undefined);
  // Kept current for the stable loadBusinesses/loadDeals callbacks (which prefer the
  // server-side nearby RPC) without rebuilding them on every geo/favorites change.
  const geoRef = useRef(userGeo);
  geoRef.current = userGeo;
  const favoriteIdsRef = useRef(favoriteBusinessIds);
  favoriteIdsRef.current = favoriteBusinessIds;
  const dealsFade = useSharedValue(0);
  const dealsFadeStyle = useAnimatedStyle(() => ({ opacity: dealsFade.value }));

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getCustomerPreferredDealLocale().then((locale) => {
      if (!cancelled) setCustomerPreferredDealLocaleState(locale);
    });
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  // Scarcity counts for capped deals. RLS hides other users' claim rows, so this
  // goes through the aggregate-only deal_claim_counts RPC (20260716120000). Until
  // that migration is applied the call errors and the map stays empty — the feed
  // simply shows no scarcity line.
  useEffect(() => {
    const cappedIds = deals
      .filter((d) => typeof d.max_claims === "number" && d.max_claims > 0)
      .map((d) => d.id);
    if (cappedIds.length === 0) {
      setClaimCountsByDeal(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("deal_claim_counts", { p_deal_ids: cappedIds });
      if (cancelled || error || !Array.isArray(data)) {
        if (!cancelled) setClaimCountsByDeal(new Map());
        return;
      }
      const m = new Map<string, number>();
      for (const row of data as { deal_id: string; claim_count: number }[]) {
        if (typeof row.deal_id === "string" && typeof row.claim_count === "number") {
          m.set(row.deal_id, row.claim_count);
        }
      }
      setClaimCountsByDeal(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [deals]);

  useEffect(() => {
    if (!customerLocaleResolutionEnabled || deals.length === 0) {
      setCustomerDealLocalizationsByDealId(new Map());
      return;
    }
    let cancelled = false;
    void fetchCustomerDealLocalizations(
      deals.map((deal) => deal.id),
      customerDealLocalizationLocale,
    ).then((localizations) => {
      if (!cancelled) setCustomerDealLocalizationsByDealId(localizations);
    });
    return () => {
      cancelled = true;
    };
  }, [customerDealLocalizationLocale, customerLocaleResolutionEnabled, deals]);

  useEffect(() => {
    if (!composedCustomerRendererEnabled || deals.length === 0) {
      setCustomerDealPosterSpecsByDealId(new Map());
      return;
    }
    let cancelled = false;
    void fetchCustomerDealPosterSpecs(deals.map((deal) => deal.id)).then((posterSpecs) => {
      if (!cancelled) setCustomerDealPosterSpecsByDealId(posterSpecs);
    });
    return () => {
      cancelled = true;
    };
  }, [composedCustomerRendererEnabled, deals]);

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

  /** Load repeat-claim policy + this user's per-business redemption history for the visible
   *  deal set, so restricted deals can be hidden. Best-effort: on any failure the maps stay
   *  empty and nothing is hidden (the claim-deal edge function still enforces the limit). */
  const loadRepeatVisibility = useCallback(
    async (dealBusinessIds: string[]) => {
      const ids = Array.from(new Set(dealBusinessIds.filter(Boolean)));
      if (ids.length === 0) {
        setRepeatPolicyByBusiness(new Map());
        setLastRedeemedByBusiness(new Map());
        return;
      }
      const [policies, redemptions] = await Promise.all([
        loadBusinessRepeatPolicies(ids),
        loadBusinessRedemptionMap(userId, ids),
      ]);
      setRepeatPolicyByBusiness(policies);
      setLastRedeemedByBusiness(redemptions);
    },
    [userId],
  );

  const loadDeals = useCallback(async () => {
    setLoadingDeals(true);
    const geo = geoRef.current;
    const nowIso = new Date().toISOString();
    try {
      let rows: Deal[] | null = null;
      // Prefer server-side geo filtering: nearest deals within a generous radius plus
      // favorites, then hydrate full rows with the existing select. Falls back to the
      // bounded global active query when there's no location yet or the RPC is
      // unavailable (e.g. not yet deployed) — behavior is unchanged until the migration ships.
      if (geo) {
        const { data: nearby, error: rpcErr } = await supabase.rpc("nearby_deals", {
          p_lat: geo.lat,
          p_lng: geo.lng,
          p_radius_miles: NEARBY_FETCH_MILES,
          p_limit: 80,
          p_offset: 0,
          p_favorite_ids: favoriteIdsRef.current,
        });
        if (!rpcErr && Array.isArray(nearby)) {
          const ids = (nearby as { id: string }[]).map((r) => r.id);
          if (ids.length === 0) {
            rows = [];
          } else {
            const { data, error } = await fetchDealsByIdsForFeed(ids);
            if (!error && Array.isArray(data)) rows = data as unknown as Deal[];
          }
          if (rows !== null) {
            const { data: activeData, error: activeErr } = await fetchActiveDealsForFeed(nowIso);
            if (!activeErr && Array.isArray(activeData)) {
              const unlocatedDeals = (activeData as unknown as Deal[]).filter(
                (deal) => readBusinessCoordinates(deal.businesses) == null,
              );
              rows = mergeDealsById(rows, unlocatedDeals);
            }
          }
        }
      }
      if (rows === null) {
        const { data, error } = await fetchActiveDealsForFeed(nowIso);
        if (error) {
          logPostgrestError("home screen deals", error);
          setBanner(t("consumerHome.loadDealsError"));
          setDeals([]);
          return;
        }
        rows = (data ?? []) as unknown as Deal[];
      }
      const filtered = rows.filter((deal) => isDealActiveNow(deal));
      setDeals(filtered);
      await Promise.all([
        loadUserClaims(filtered.map((d) => d.id)),
        loadRepeatVisibility(filtered.map((d) => d.business_id)),
      ]);
    } catch (error) {
      const err = error instanceof Error ? { message: error.message } : { message: "Unknown deals load error" };
      logPostgrestError("home screen deals", err);
      setBanner(t("consumerHome.loadDealsError"));
      setDeals([]);
    } finally {
      setLoadingDeals(false);
    }
  }, [loadUserClaims, loadRepeatVisibility, t]);

  // Re-fetch the nearby deal set when location changes (the user's own radius filter
  // is applied client-side over the fetched set, so radius changes don't need a reload).
  useEffect(() => {
    if (!userGeo) return;
    void loadDeals();
  }, [userGeo, loadDeals]);

  const loadBusinesses = useCallback(async () => {
    setLoadingBiz(true);
    try {
      const geo = geoRef.current;
      // Discovery surface: fetch all shops in the metro (nearest first, plus favorites)
      // via the indexed nearby RPC — NOT filtered to the user's tighter radius, matching
      // the original Shops tab. Falls back to the page-by-page load when there's no
      // location yet or the RPC is unavailable.
      if (geo) {
        const { data, error } = await supabase.rpc("nearby_businesses", {
          p_lat: geo.lat,
          p_lng: geo.lng,
          p_radius_miles: NEARBY_FETCH_MILES,
          p_limit: 200,
          p_offset: 0,
          p_favorite_ids: favoriteIdsRef.current,
        });
        if (!error && Array.isArray(data)) {
          const nearbyBusinesses = (
            data as { id: string; name: string; location: string | null; latitude: number | null; longitude: number | null }[]
          ).map((r) => ({ id: r.id, name: r.name, location: r.location, latitude: r.latitude, longitude: r.longitude })) as BusinessRow[];
          let unlocatedBusinesses: BusinessRow[] = [];
          try {
            unlocatedBusinesses = (await collectBusinessesPageByPage(async ({ from, to }) => {
              return await supabase
                .from("businesses")
                .select("id,name,location,latitude,longitude")
                .or("latitude.is.null,longitude.is.null")
                .order("name", { ascending: true })
                .range(from, to);
            })) as BusinessRow[];
          } catch (unlocatedError) {
            if (__DEV__) {
              const msg = unlocatedError instanceof Error ? unlocatedError.message : String(unlocatedError);
              console.warn("[home] unlocated businesses load:", msg);
            }
          }
          setBusinesses(mergeBusinessRowsById(nearbyBusinesses, unlocatedBusinesses));
          setLoadingBiz(false);
          return;
        }
      }
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

  // Re-fetch the shop set when location changes. The fetch radius is fixed (metro-wide),
  // so the user's radius changes don't affect the Shops list and don't need a reload.
  useEffect(() => {
    if (!userGeo) return;
    void loadBusinesses();
  }, [userGeo, loadBusinesses]);

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
    setSortMode(prefs.dealSortMode);
    setFavoritesOnly(prefs.notificationPrefs.mode === "favorites_only");
    setPreferredCategories(prefs.notificationPrefs.categoryTags ?? []);
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

      void hydrateLocationFromPrefs();

      if (cooldownActive && !userChanged) {
        return;
      }

      lastFeedFocusHydrateAtRef.current = now;
      lastFeedFocusHydrateUserIdRef.current = uid;

      void loadDeals();
      void loadBusinesses();
      void loadFavorites(userId);
    }, [loadDeals, loadBusinesses, loadFavorites, userId, hydrateLocationFromPrefs]),
  );

  useEffect(() => {
    if (!userId) return;
    void syncConsumerDealNotifications({ userId, favoriteBusinessIds });
  }, [userId, favoriteBusinessIds, deals.length]);

  // Consent-gated deal alerts. We never silently enable notifications when a user
  // favorites a shop — we ask once per session, and only request OS permission if
  // they accept.
  const alertConsentAskedRef = useRef(false);
  const enableDealAlerts = useCallback(async () => {
    const { status, skippedBecauseExpoGo } = await requestNotificationPermissionsSafe();
    if (skippedBecauseExpoGo || status !== "granted") {
      setAlertDialog("permissionDenied");
      return;
    }
    if (userId) {
      const registration = await registerPushTokenWithResult(userId);
      if (!registration.ok) {
        setAlertDialog("registrationFailed");
        return;
      }
    }
    await setAlertsEnabled(true);
    await setConsumerNotificationPrefs({ v: 1, mode: "favorites_only" });
  }, [userId]);
  const maybeOfferDealAlerts = useCallback(async () => {
    if (alertConsentAskedRef.current) return;
    if (await getAlertsEnabled()) return; // already opted in — don't nag
    alertConsentAskedRef.current = true;
    setAlertDialog("consent");
  }, []);

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
        } else {
          void maybeOfferDealAlerts();
        }
      }
    },
    [userId, favoriteBusinessIds, t, maybeOfferDealAlerts],
  );

  const doClaim = useCallback(
    async (dealId: string) => {
      try {
        if (!isLoggedIn) {
          setBanner(t("dealDetail.errLoginClaim"));
          return;
        }
        const requestedDeal = dealsRef.current.find((d) => d.id === dealId);
        if (isDemoOffer(requestedDeal)) {
          setBanner(DEMO_OFFER_SHORT_EXPLANATION);
          setClaimStatus((prev) => ({
            ...prev,
            [dealId]: { message: DEMO_OFFER_SHORT_EXPLANATION, tone: "info" },
          }));
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
        setUserClaimsByDeal((prev) => {
          const next = new Map(prev);
          next.set(dealId, {
            redeemed_at: null,
            expires_at: out.expires_at,
            grace_period_minutes: DEFAULT_CLAIM_GRACE_MINUTES,
          });
          return next;
        });
        setClaimingDealId(null);
        setQrVisible(true);
        setClaimStatus((prev) => ({
          ...prev,
          [dealId]: { message: t("dealsBrowse.statusClaimedShowQr"), tone: "success" },
        }));
        void loadUserClaims(dealsRef.current.map((d) => d.id));
        // Retention nudge: remind ~1h before this claim's redemption deadline.
        const claimedDeal = dealsRef.current.find((d) => d.id === dealId);
        const claimedDealDisplay = claimedDeal
          ? buildLocalizedDealDisplay({
              deal: customerDealLocalizationsByDealId.has(claimedDeal.id)
                ? { ...claimedDeal, customer_deal_localization: customerDealLocalizationsByDealId.get(claimedDeal.id) ?? null }
                : claimedDeal,
              locale: customerDealLocalizationLocale,
              localeResolutionSource: customerDealLocalizationResolution.source,
              useLocalizedOfferRenderer: shouldUseCustomerLocalizedOfferRenderer(
                customerDealLocalizationLocale,
                localizedOfferRendererEnabled,
              ),
              fallbackLanguage: i18n.language,
            })
          : null;
        void scheduleClaimExpiryReminder({
          claimExpiresAt: out.expires_at,
          graceMinutes: DEFAULT_CLAIM_GRACE_MINUTES,
          dealTitle: claimedDealDisplay?.title ?? null,
        });
      } catch (e: unknown) {
        const msg = messageFromThrown(e) ?? t("apiErrors.operationFailedTryAgain");
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
    [
      isLoggedIn,
      claimingDealId,
      loadUserClaims,
      mapClaimError,
      t,
      customerDealLocalizationLocale,
      customerDealLocalizationResolution.source,
      customerDealLocalizationsByDealId,
      i18n.language,
      localizedOfferRendererEnabled,
    ],
  );

  const hideClaimQrModal = useCallback(() => {
    setQrVisible(false);
    setClaimingDealId(null);
    void loadUserClaims(dealsRef.current.map((d) => d.id));
  }, [loadUserClaims]);

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
      const msg = messageFromThrown(e) ?? t("apiErrors.operationFailedTryAgain");
      setBanner(mapClaimError(msg));
    } finally {
      setRefreshingQr(false);
    }
  }

  const onSelectSortMode = useCallback((mode: ConsumerDealSortMode) => {
    setSortMode(mode);
    void setConsumerDealSortMode(mode);
  }, []);

  const sortModeLabel = useCallback(
    (mode: ConsumerDealSortMode) => {
      switch (mode) {
        case "nearest":
          return t("consumerHome.sortNearest");
        case "endingSoon":
          return t("consumerHome.sortEndingSoon");
        case "newest":
          return t("consumerHome.sortNewest");
        default:
          return t("consumerHome.sortForYou");
      }
    },
    [t],
  );

  // Hide deals the customer is currently repeat-restricted from, so they never see a deal
  // they can't claim. Applied upstream of search/radius/sort (and any realtime-added deals).
  // When no business in view has an active limit, the maps are empty and this is a no-op.
  const repeatVisibleDeals = useMemo(() => {
    if (repeatPolicyByBusiness.size === 0) return deals;
    return deals.filter(
      (d) =>
        !isDealHiddenByRepeatPolicy({
          policy: repeatPolicyByBusiness.get(d.business_id),
          lastRedeemedAt: lastRedeemedByBusiness.get(d.business_id) ?? null,
          nowMs: nowTick,
        }),
    );
  }, [deals, repeatPolicyByBusiness, lastRedeemedByBusiness, nowTick]);

  const searchFilteredDeals = useMemo(
    () => repeatVisibleDeals.filter((d) => dealMatchesSearch(d, searchQuery)),
    [repeatVisibleDeals, searchQuery],
  );

  const dealsWithinRadius = useMemo(() => {
    if (!userGeo) return searchFilteredDeals;
    return searchFilteredDeals.filter((deal) =>
      shouldShowDealInNearbyFeed({
        deal,
        userGeo,
        radiusMiles,
        favoriteBusinessIds,
      }),
    );
  }, [searchFilteredDeals, userGeo, radiusMiles, favoriteBusinessIds]);

  const liveDealsDisplay = useMemo(() => {
    let list = showAllLiveDeals ? searchFilteredDeals : dealsWithinRadius;
    if (favoritesOnly) {
      list = list.filter((d) => favoriteBusinessIds.includes(d.business_id));
    }
    const distanceOf = (deal: Deal) => {
      if (!userGeo) return Number.POSITIVE_INFINITY;
      const c = readBusinessCoordinates(deal.businesses);
      return c ? haversineMiles(userGeo.lat, userGeo.lng, c.lat, c.lng) : Number.POSITIVE_INFINITY;
    };
    const endOf = (deal: Deal) => new Date(deal.end_time).getTime();
    // Deals from before the created_at column was selected sort as oldest.
    const createdOf = (deal: Deal) => (deal.created_at ? new Date(deal.created_at).getTime() : 0);
    return [...list].sort((a, b) => {
      if (sortMode === "nearest") {
        const da = distanceOf(a);
        const db = distanceOf(b);
        if (da !== db) return da - db;
        return endOf(a) - endOf(b);
      }
      if (sortMode === "endingSoon") {
        const ea = endOf(a);
        const eb = endOf(b);
        if (ea !== eb) return ea - eb;
        return distanceOf(a) - distanceOf(b);
      }
      if (sortMode === "newest") {
        const ca = createdOf(a);
        const cb = createdOf(b);
        if (ca !== cb) return cb - ca;
        return distanceOf(a) - distanceOf(b);
      }
      // "recommended": favorites, then preferred categories, then distance, then
      // ending soonest — the first feed feels personalized without hiding anything.
      const aFav = favoriteBusinessIds.includes(a.business_id) ? 0 : 1;
      const bFav = favoriteBusinessIds.includes(b.business_id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      if (preferredCategories.length) {
        const aCat = preferredCategories.includes((a.businesses?.category ?? "").toLowerCase()) ? 0 : 1;
        const bCat = preferredCategories.includes((b.businesses?.category ?? "").toLowerCase()) ? 0 : 1;
        if (aCat !== bCat) return aCat - bCat;
      }
      const da = distanceOf(a);
      const db = distanceOf(b);
      if (da !== db) return da - db;
      return endOf(a) - endOf(b);
    });
  }, [searchFilteredDeals, dealsWithinRadius, showAllLiveDeals, favoritesOnly, favoriteBusinessIds, userGeo, preferredCategories, sortMode]);

  // Impressions are tracked from real viewport visibility via the FlatList's
  // onViewableItemsChanged (see onViewableDealsChangedRef), deduped per session.
  // This replaces the old effect that re-counted the whole list on every recompute
  // (search keystrokes, favorite/radius/segment changes) and inflated merchant numbers.

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
      const coords = readBusinessCoordinates(item.businesses);
      const distanceMiles = userGeo && coords ? haversineMiles(userGeo.lat, userGeo.lng, coords.lat, coords.lng) : null;
      const formattedDistance = distanceMiles != null ? formatDistanceMiles(distanceMiles) : null;
      const distanceLabel =
        formattedDistance
          ? t("dealsBrowse.distanceAwayMiles", {
              distance: formattedDistance,
            })
          : undefined;
      const st = dealStatusForUser(item, userClaimsByDeal, nowTick);
      // Scarcity: "Only N left" when a capped deal is nearly gone (1-5 remaining).
      // Shows nothing when plentiful, sold out, or counts are unavailable.
      const cap = typeof item.max_claims === "number" && item.max_claims > 0 ? item.max_claims : null;
      const countForDeal = cap !== null ? claimCountsByDeal.get(item.id) : undefined;
      const remainingForDeal = cap !== null && countForDeal !== undefined ? Math.max(0, cap - countForDeal) : null;
      const scarcityLabel =
        remainingForDeal !== null && remainingForDeal >= 1 && remainingForDeal <= 5
          ? remainingForDeal === 1
            ? t("consumerHome.onlyOneLeft")
            : t("consumerHome.onlyNLeft", { count: remainingForDeal })
          : null;
      const resolvedDisplayLocale = customerLocaleResolutionEnabled
        ? resolveDealDisplayLocale({
            customerPreferredLocale: customerPreferredDealLocale,
            appLanguage: i18n.language,
            deviceLanguage: deviceDealLocaleRef.current,
            adSourceLocale: item.source_locale,
          })
        : {
            locale: supportedLocaleOrDefault(i18n.language),
            source: "app_language" as const,
            enabledLocales: [supportedLocaleOrDefault(i18n.language)],
          };
      const localizedDisplay = buildLocalizedDealDisplay({
        deal: customerDealLocalizationsByDealId.has(item.id)
          ? { ...item, customer_deal_localization: customerDealLocalizationsByDealId.get(item.id) ?? null }
          : item,
        locale: resolvedDisplayLocale.locale,
        localeResolutionSource: resolvedDisplayLocale.source,
        useLocalizedOfferRenderer: shouldUseCustomerLocalizedOfferRenderer(
          resolvedDisplayLocale.locale,
          localizedOfferRendererEnabled,
        ),
        fallbackLanguage: i18n.language,
      });
      const offerText = localizedDisplay.title || t("dealDetail.dealFallback");
      const posterUri = resolveDealPosterDisplayUri(item.poster_url, item.poster_storage_path);
      const businessName = item.businesses?.name ?? t("dealDetail.localBusiness");
      const businessLocation = item.businesses?.location?.trim() || null;
      const isFavorite = favoriteBusinessIds.includes(item.business_id);
      const itemIsDemo = isDemoOffer(item);
      const isLive = st === "live";
      const displayDescription = localizedDisplay.description;
      const statusLabel =
        st === "live"
          ? t("dealStatus.live")
          : st === "claimed"
            ? t("dealStatus.claimed")
            : st === "redeemed"
              ? t("dealStatus.redeemed")
              : t("dealStatus.expired");
      const claimButtonTitle =
        itemIsDemo
          ? t("demoOffer.label", { defaultValue: "Demo offer" })
          : claimingDealId === item.id
          ? t("dealsBrowse.statusClaiming")
          : st === "claimed"
            ? t("dealStatus.claimed")
            : st === "redeemed"
              ? t("dealStatus.redeemed")
              : st === "expired"
                ? t("dealStatus.expired")
                : t("dealDetail.claimButton");
      const statusColor =
        st === "live"
          ? { background: PrimaryTint.surfaceStrong, border: PrimaryTint.border, text: theme.accentText }
          : st === "claimed"
            ? {
                background: colorScheme === "dark" ? "rgba(255,159,28,0.18)" : "rgba(255,159,28,0.14)",
                border: colorScheme === "dark" ? "rgba(255,180,84,0.36)" : "rgba(180,83,9,0.22)",
                text: theme.accentText,
              }
            : {
                background: theme.surfaceMuted,
                border: theme.border,
                text: theme.mutedText,
              };
      if (composedCustomerRendererEnabled) {
        const offerFacts = localizedDisplay.lockedOfferContent ?? renderAuthoritativeOfferFromDeal(item, {
          title: offerText,
          description: displayDescription,
        });
        const supportingCopy = localizedDisplay.localizedCreative?.supportingCopy || displayDescription || t("consumerHome.tagline");
        const posterSpec = customerDealPosterSpecsByDealId.get(item.id)?.posterSpec ?? null;
        const presentation = buildDefaultAdPresentationSpec({
          imageAssetId: item.poster_storage_path ?? posterUri ?? null,
          imageSourceType: posterUri ? "merchant_original" : "deterministic_fallback",
          templateId: isLive && scarcityLabel ? "live_drop_card" : "split_offer_panel",
          themeId: colorScheme === "dark" ? "dark_neutral" : "light_neutral",
          resolutionReasonCodes: posterUri ? ["CONSUMER_FEED_IMAGE"] : ["CONSUMER_FEED_FALLBACK"],
        });
        const copy = buildApprovedAdCopy({
          headline: offerText,
          supportingCopy,
          ctaLabel: claimButtonTitle,
          fallbackHeadline: offerFacts.primaryOfferLine,
        });
        const merchant = buildMerchantIdentity({
          businessName,
          locationName: businessLocation,
        });
        const liveState = {
          status:
            st === "live"
              ? ("live" as const)
              : st === "claimed"
                ? ("claimed" as const)
                : st === "redeemed"
                  ? ("redeemed" as const)
                  : ("ended" as const),
          statusLabel,
          quantityRemainingLabel: isLive ? scarcityLabel : null,
          timeRemainingLabel: isLive ? formatTimeLeft(item.end_time) : null,
          claimAvailable: isLive && !itemIsDemo && claimingDealId !== item.id,
        };

        return (
          <View style={{ marginBottom: Spacing.xl }}>
            <ComposedAdCard
              imageUri={posterUri}
              posterSpec={posterSpec}
              contentLocale={resolvedDisplayLocale.locale}
              offerFacts={offerFacts}
              merchant={merchant}
              copy={copy}
              presentation={presentation}
              liveState={liveState}
              surface="consumer_feed"
              fallbackVisualLabel={t("consumerHome.noPhotoYet", { defaultValue: "Photo coming soon" })}
              onCardPress={() => router.push(`/deal/${item.id}`)}
              onPrimaryAction={() => void doClaim(item.id)}
              secondaryAction={{
                label: isFavorite ? t("dealsBrowse.cardSaved") : t("dealsBrowse.cardSaveFavorite"),
                selected: isFavorite,
                onPress: () => void toggleFavorite(item.business_id),
                accessibilityLabel: isFavorite ? t("dealDetail.favorited") : t("dealDetail.favorite"),
              }}
            />
          </View>
        );
      }
      const businessInitial = businessName.trim().charAt(0).toUpperCase() || "T";
      return (
        <View
          style={{
            marginBottom: Spacing.xl,
            borderRadius: Radii.lg,
            backgroundColor: theme.surface,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Pressable onPress={() => router.push(`/deal/${item.id}`)} accessibilityRole="button">
            {posterUri ? (
              <Image
                source={{ uri: posterUri }}
                style={{ width: "100%", aspectRatio: 1 }}
                contentFit="cover"
              />
            ) : (
              <View
                style={{
                  width: "100%",
                  aspectRatio: 1,
                  backgroundColor: colorScheme === "dark" ? "rgba(255,159,28,0.12)" : "rgba(255,159,28,0.09)",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                }}
              >
                <View
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: 34,
                    backgroundColor: theme.surface,
                    borderWidth: 1,
                    borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.36)" : "rgba(255,159,28,0.28)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MaterialIcons name="local-cafe" size={30} color={theme.primary} />
                  <Text style={{ color: theme.accentText, fontSize: 17, fontWeight: "900" }} numberOfLines={1}>
                    {businessInitial}
                  </Text>
                </View>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "800" }} numberOfLines={1}>
                  {businessName}
                </Text>
                <Text style={{ color: theme.mutedText, fontSize: 13, fontWeight: "600", textAlign: "center" }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
                  {t("consumerHome.noPhotoYet", { defaultValue: "Photo coming soon" })}
                </Text>
              </View>
            )}
          </Pressable>
          <View style={{ padding: Spacing.lg, gap: Spacing.sm }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: Spacing.sm }}>
              <Text style={{ fontSize: 20, fontWeight: "800", flex: 1, color: theme.text }} numberOfLines={2}>
                {businessName}
              </Text>
              <Pressable
                onPress={() => void toggleFavorite(item.business_id)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityState={{ selected: isFavorite }}
                accessibilityLabel={isFavorite ? t("dealDetail.favorited") : t("dealDetail.favorite")}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isFavorite
                    ? colorScheme === "dark"
                      ? "rgba(240,70,122,0.18)"
                      : "rgba(224,36,94,0.12)"
                    : pressed
                      ? theme.surfaceMuted
                      : theme.surface,
                  borderWidth: 1,
                  borderColor: isFavorite ? theme.favorite : theme.border,
                })}
              >
                <MaterialIcons
                  name={isFavorite ? "favorite" : "favorite-border"}
                  size={25}
                  color={isFavorite ? theme.favorite : theme.icon}
                />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, flexWrap: "wrap" }}>
              <View
                style={{
                  borderRadius: Radii.pill,
                  paddingHorizontal: Spacing.md,
                  paddingVertical: 5,
                  backgroundColor: statusColor.background,
                  borderWidth: 1,
                  borderColor: statusColor.border,
                  maxWidth: "100%",
                }}
              >
                <Text
                  style={{ fontSize: 12, fontWeight: "800", color: statusColor.text }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.76}
                  maxFontSizeMultiplier={1.15}
                >
                  {statusLabel}
                </Text>
              </View>
              {distanceLabel ? (
                <Text style={{ color: theme.accentText, fontWeight: "800", fontSize: 13 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {distanceLabel}
                </Text>
              ) : null}
              {businessLocation ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, minWidth: 0, maxWidth: "100%" }}>
                  <MaterialIcons name="place" size={15} color={theme.mutedText} />
                  <Text style={{ color: theme.mutedText, fontWeight: "600", fontSize: 13, flexShrink: 1 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                    {businessLocation}
                  </Text>
                </View>
              ) : null}
            </View>
            {itemIsDemo ? <DemoOfferNotice compact /> : null}
            <Text style={{ fontSize: 22, lineHeight: 30, fontWeight: "900", color: theme.text }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
              {offerText}
            </Text>
            <Text numberOfLines={2} style={{ fontSize: 15, color: theme.mutedText, lineHeight: 22 }} maxFontSizeMultiplier={1.15}>
              {displayDescription || t("consumerHome.tagline")}
            </Text>
            <View style={{ marginTop: Spacing.xs, flexDirection: "row", alignItems: "center", gap: Spacing.xs, flexWrap: "wrap" }}>
              <MaterialIcons name={isLive ? "schedule" : "confirmation-number"} size={16} color={isLive ? theme.accentText : theme.mutedText} />
              <Text style={{ color: isLive ? theme.accentText : theme.mutedText, fontWeight: "800", fontSize: 14, flexShrink: 1 }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
                {isLive ? formatTimeLeft(item.end_time) : statusLabel}
              </Text>
              {isLive && scarcityLabel ? (
                <Text style={{ color: theme.accentText, fontWeight: "800", fontSize: 14 }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                  {scarcityLabel}
                </Text>
              ) : null}
            </View>
            {claimStatus[item.id]?.message ? (
              <Text style={{ marginTop: Spacing.sm, fontSize: 13, lineHeight: 18, color: theme.mutedText }} maxFontSizeMultiplier={1.15}>
                {claimStatus[item.id]?.message}
              </Text>
            ) : null}
            <View style={{ marginTop: Spacing.sm }}>
              <PrimaryButton
                title={claimButtonTitle}
                onPress={() => void doClaim(item.id)}
                disabled={itemIsDemo || claimingDealId === item.id || st !== "live"}
              />
            </View>
            <Pressable
              onPress={() => router.push(businessDetailHref(item.business_id, distanceLabel))}
              accessibilityRole="button"
              accessibilityLabel={t("consumerHome.shopInfoLink")}
              style={{ paddingVertical: Spacing.sm, alignItems: "center" }}
            >
              <Text
                style={{ color: theme.accentText, fontWeight: "700", fontSize: 15, textAlign: "center" }}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                maxFontSizeMultiplier={1.15}
              >
                {t("consumerHome.shopInfoLink")}
              </Text>
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
      colorScheme,
      composedCustomerRendererEnabled,
      customerLocaleResolutionEnabled,
      customerPreferredDealLocale,
      toggleFavorite,
      formatTimeLeft,
      claimStatus,
      claimingDealId,
      claimCountsByDeal,
      customerDealLocalizationsByDealId,
      customerDealPosterSpecsByDealId,
      doClaim,
      i18n.language,
      localizedOfferRendererEnabled,
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
      const formattedDistance =
        userGeo && Number.isFinite(la) && Number.isFinite(ln)
          ? formatDistanceMiles(haversineMiles(userGeo.lat, userGeo.lng, la, ln))
          : null;
      const distanceLabel =
        formattedDistance
          ? t("dealsBrowse.distanceAwayMiles", {
              distance: formattedDistance,
            })
          : undefined;
      return (
        <BusinessRowCard
          name={b.name}
          address={compactLocationLabel(b.location)}
          hasLiveDeal={liveDealIds.has(b.id)}
          isFavorite={favoriteBusinessIds.includes(b.id)}
          distanceLabel={distanceLabel}
          onPress={() => router.push(businessDetailHref(b.id, distanceLabel))}
          onToggleFavorite={() => void toggleFavorite(b.id)}
        />
      );
    },
    [feedSegment, renderDealItem, userGeo, t, liveDealIds, favoriteBusinessIds, router, toggleFavorite],
  );

  const listHeader = useMemo(
    () => (
      <View style={{ marginBottom: Spacing.md }}>
        <ScreenHeader title="Twofer" subtitle={t("consumerHome.tagline")} />

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
              maxFontSizeMultiplier={1.15}
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
              maxWidth: "100%",
            }}
          >
            <MaterialIcons name="place" size={18} color={theme.primary} />
            <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: "700", color: theme.text }} numberOfLines={1} maxFontSizeMultiplier={1.15}>
              {!userGeo
                ? t("consumerHome.locationChipNoLocation")
                : feedSegment === "shops"
                  ? // Shops is intentionally metro-wide (not radius-filtered), so don't
                    // imply the 5 mi radius applies here — only Deals are radius-filtered.
                    t("consumerHome.shopsLocationChipMetro")
                  : t("consumerHome.locationChipWithRadius", { miles: radiusMiles })}
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
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: favoritesOnly
                    ? colorScheme === "dark"
                      ? "rgba(236,72,153,0.2)"
                      : "rgba(224,36,94,0.12)"
                    : pressed
                      ? theme.surfaceMuted
                      : "transparent",
                  borderWidth: 1,
                  borderColor: favoritesOnly ? theme.favorite : theme.border,
                })}
              >
                <MaterialIcons
                  name={favoritesOnly ? "favorite" : "favorite-border"}
                  size={26}
                  color={favoritesOnly ? theme.favorite : theme.mutedText}
                />
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: Spacing.md }}
              contentContainerStyle={{ flexDirection: "row", gap: Spacing.sm }}
              accessibilityLabel={t("consumerHome.sortDeals")}
            >
              {CONSUMER_DEAL_SORT_MODES.map((mode) => {
                const selected = sortMode === mode;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => onSelectSortMode(mode)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={sortModeLabel(mode)}
                    style={{
                      borderRadius: Radii.pill,
                      borderWidth: 1,
                      borderColor: selected ? theme.primary : theme.border,
                      backgroundColor: selected ? theme.primary : theme.surfaceMuted,
                      paddingVertical: Spacing.sm,
                      paddingHorizontal: Spacing.md,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "700",
                        color: selected ? theme.primaryText : theme.text,
                      }}
                      maxFontSizeMultiplier={1.15}
                    >
                      {sortModeLabel(mode)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {favoritesOnly ? (
              <Text style={{ fontSize: 13, marginBottom: Spacing.md, lineHeight: 18, color: theme.mutedText }}>
                {t("consumerHome.favoritesOnlyActive")}
              </Text>
            ) : null}

            {emptyNearbyLive ? (
              <View
                style={{
                  borderRadius: Radii.lg,
                  backgroundColor: theme.surface,
                  padding: Spacing.xxxl,
                  marginBottom: Spacing.xxxl,
                  borderWidth: 1,
                  borderColor: colorScheme === "dark" ? "rgba(255,159,28,0.38)" : "rgba(255,159,28,0.22)",
                  gap: Spacing.md,
                  alignItems: "center",
                  ...Shadows.soft,
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
                    source={require("../../assets/images/twofer-mark-512.png")}
                    style={{ width: 30, height: 30, opacity: 0.95 }}
                    contentFit="contain"
                  />
                </View>
                <Text style={{ fontSize: 17, fontWeight: "700", color: theme.text }}>{t("consumerHome.emptyNearbyTitle")}</Text>
                <Text style={{ opacity: 0.72, lineHeight: 22, textAlign: "center", color: theme.text }}>
                  {t("consumerHome.emptyNearbyBodySub")}
                </Text>
                <Text style={{ fontSize: 13, color: theme.accentText, opacity: 0.95, lineHeight: 20, textAlign: "center" }}>
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
                    borderRadius: Radii.lg,
                    padding: Spacing.md,
                    borderWidth: 1,
                    borderColor: colorScheme === "dark" ? "rgba(244,114,182,0.32)" : "#fce7f3",
                  }
                : {}),
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", marginBottom: Spacing.sm, color: theme.mutedText }}>
              {t("consumerHome.favoritesStripTitle")}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.sm }}>
              {favoriteBusinessIds.map((fid) => {
                const b = businesses.find((x) => x.id === fid);
                if (!b) return null;
                return (
                  <Pressable
                    key={fid}
                    onPress={() => router.push(businessDetailHref(fid))}
                    style={{
                      paddingVertical: Spacing.sm,
                      paddingHorizontal: Spacing.md,
                      borderRadius: Radii.pill,
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
      sortMode,
      onSelectSortMode,
      sortModeLabel,
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
          viewabilityConfig={viewabilityConfigRef.current}
          onViewableItemsChanged={onViewableDealsChangedRef.current}
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
              ? emptyNearbyLive || showDealsSkeleton || banner
                ? null
                : (
                    <EmptyState
                      title={t("consumerHome.emptyLiveTitle")}
                      message={t("consumerHome.emptyLiveBody")}
                      actionLabel={businesses.length > 0 ? t("consumerHome.browseShopsCta") : t("commonUi.tryAgain")}
                      onAction={businesses.length > 0 ? () => setFeedSegment("shops") : () => void onPullToRefresh()}
                    />
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
        onHide={hideClaimQrModal}
        onRefresh={refreshQr}
        refreshing={refreshingQr}
      />

      <BrandedConfirmModal
        visible={alertDialog === "consent"}
        iconName="notifications-active"
        title={t("consumerHome.alertConsentTitle")}
        message={t("consumerHome.alertConsentBody")}
        confirmLabel={t("consumerHome.alertConsentAccept")}
        cancelLabel={t("consumerHome.alertConsentDecline")}
        onConfirm={() => {
          setAlertDialog(null);
          void enableDealAlerts();
        }}
        onCancel={() => setAlertDialog(null)}
      />
      <BrandedConfirmModal
        visible={alertDialog === "permissionDenied"}
        iconName="notifications-off"
        title={t("consumerHome.alertsDeniedTitle")}
        message={t("settingsScreen.alertsPermissionBody")}
        confirmLabel={t("commonUi.ok")}
        onConfirm={() => setAlertDialog(null)}
      />
      <BrandedConfirmModal
        visible={alertDialog === "registrationFailed"}
        iconName="notifications-off"
        title={t("consumerHome.alertsDeniedTitle")}
        message={t("settingsScreen.alertsRegistrationFailed", {
          defaultValue: PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE,
        })}
        confirmLabel={t("commonUi.ok")}
        onConfirm={() => setAlertDialog(null)}
      />
    </View>
    </KeyboardScreen>
  );
}
