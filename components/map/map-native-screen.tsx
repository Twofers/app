import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import Constants from "expo-constants";
import MapView, { Circle, Marker, type Region } from "react-native-maps";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { devWarn } from "@/lib/dev-log";

import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { Colors } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { logPostgrestError } from "@/lib/supabase-client-log";
import { isDealActiveNow } from "@/lib/deal-time";
import { getConsumerPreferences, milesToKm } from "@/lib/consumer-preferences";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { resolveDealPosterDisplayUri } from "@/lib/deal-poster-url";
import { trackAppAnalyticsEvent } from "@/lib/app-analytics";
import { buildMapCameraFitSignature } from "@/lib/map-camera-fit";
import {
  collectMappableBusinesses,
  deriveLiveBusinessIds,
  pickPreviewDeal,
  resolveMarkerTapOutcome,
  shouldClearMapSelectionOnPress,
  type MappableBusiness,
} from "@/lib/map-businesses";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { LiveDealHaloCircles, useLiveDealPulse } from "@/components/map/live-deal-halo";

type DealLite = {
  id: string;
  title: string | null;
  description: string | null;
  poster_url: string | null;
  poster_storage_path?: string | null;
  price: number | null;
  max_claims: number | null;
  business_id: string;
  end_time: string;
  start_time: string;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  timezone: string | null;
};

function safeRegion(center: { lat: number; lng: number }, latitudeDelta: number, longitudeDelta: number): Region {
  const lat = Math.min(90, Math.max(-90, center.lat));
  const lng = Math.min(180, Math.max(-180, center.lng));
  const dLat = Number.isFinite(latitudeDelta) && latitudeDelta > 0 ? Math.min(80, Math.max(0.02, latitudeDelta)) : 0.12;
  const dLng = Number.isFinite(longitudeDelta) && longitudeDelta > 0 ? Math.min(80, Math.max(0.02, longitudeDelta)) : 0.12;
  return { latitude: lat, longitude: lng, latitudeDelta: dLat, longitudeDelta: dLng };
}

/** Dallas–Fort Worth service area fallback when GPS and markers are unavailable. */
const DALLAS_FALLBACK = { lat: 32.7767, lng: -96.797 };

type MapDataPayload = {
  radiusMiles: number;
  userPos: { lat: number; lng: number } | null;
  showDeviceBlueDot: boolean;
  businesses: MappableBusiness[];
  deals: DealLite[];
  dealsFetchFailed: boolean;
};

type MarkerWithLive = MappableBusiness & { live: boolean };

async function fetchMapDataPayload(t: (key: string) => string): Promise<MapDataPayload> {
  const prefs = await getConsumerPreferences();
  const coords = await resolveConsumerCoordinates(prefs);
  const userPos = coords ? { lat: coords.lat, lng: coords.lng } : null;
  const showDeviceBlueDot = Boolean(coords?.showsDeviceLocationBlueDot);

  const businesses = await collectMappableBusinesses(async (offset, limit) => {
    const { data, error } = await supabase
      .from("businesses")
      .select("id,name,location,latitude,longitude")
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data ?? []) as {
      id: string;
      name: string;
      location: string | null;
      latitude: number | string | null;
      longitude: number | string | null;
    }[];
  }, 400);

  const deals: DealLite[] = [];
  let dealsFetchFailed = false;
  const dealPageSize = 200;
  let dealOffset = 0;
  while (true) {
    const { data: dz, error: ed } = await supabase
      .from("deals")
      .select(
        "id,title,description,poster_url,poster_storage_path,price,max_claims,business_id,end_time,start_time,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone",
      )
      .eq("is_active", true)
      .gte("end_time", new Date().toISOString())
      .range(dealOffset, dealOffset + dealPageSize - 1);
    if (ed) {
      logPostgrestError("map screen deals", ed);
      // Keep existing deals on transient failures.
      dealsFetchFailed = true;
      break;
    }
    const page = (dz ?? []) as DealLite[];
    deals.push(...page);
    if (page.length < dealPageSize) break;
    dealOffset += dealPageSize;
  }

  if (dealsFetchFailed) {
    devWarn("[map] deals fetch failed; preserving previous deals", t("consumerMap.dataError"));
  }

  return {
    radiusMiles: prefs.radiusMiles,
    userPos,
    showDeviceBlueDot,
    businesses,
    deals,
    dealsFetchFailed,
  };
}

function renderMapLoading(t: (key: string) => string) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color={Colors.light.primary} />
      <Text style={{ marginTop: Spacing.md, opacity: 0.65, fontSize: 13 }}>{t("consumerMap.subtitleAll")}</Text>
    </View>
  );
}

function renderAndroidMapsUnavailable(t: (key: string) => string, horizontal: number) {
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: horizontal }}>
      <EmptyState
        title={t("consumerMap.androidMapsUnavailableTitle")}
        message={t("consumerMap.androidMapsUnavailableBody")}
      />
    </View>
  );
}

function renderMapCanvas({
  horizontal,
  loadMapData,
  mapRef,
  initialRegion,
  showUserLocationDot,
  setMapReady,
  setSelectedBusinessId,
  userPos,
  radiusKm,
  markers,
  livePulse,
  selectedBusinessId,
  deals,
  router,
  mapReady,
  loading,
  t,
  selectedBusiness,
  previewDeal,
  previewPosterUri,
}: {
  horizontal: number;
  loadMapData: () => Promise<void>;
  mapRef: React.RefObject<MapView | null>;
  initialRegion: Region;
  showUserLocationDot: boolean;
  setMapReady: (ready: boolean) => void;
  setSelectedBusinessId: (id: string | null) => void;
  userPos: { lat: number; lng: number } | null;
  radiusKm: number;
  markers: MarkerWithLive[];
  livePulse: ReturnType<typeof useLiveDealPulse>;
  selectedBusinessId: string | null;
  deals: DealLite[];
  router: ReturnType<typeof useRouter>;
  mapReady: boolean;
  loading: boolean;
  t: (key: string) => string;
  selectedBusiness: MarkerWithLive | null;
  previewDeal: DealLite | null;
  previewPosterUri: string | null;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        onPress={() => void loadMapData()}
        accessibilityRole="button"
        accessibilityLabel={t("consumerMap.a11yRefreshLabel")}
        accessibilityHint={t("consumerMap.a11yRefreshHint")}
        style={{
          position: "absolute",
          top: 12,
          right: horizontal + 8,
          zIndex: 999,
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: "#fff",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 4,
          elevation: 4,
        }}
      >
        <MaterialIcons name="refresh" size={22} color="#333" />
      </Pressable>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={initialRegion}
        showsUserLocation={showUserLocationDot}
        onMapReady={() => setMapReady(true)}
        onPress={(e) => {
          if (!shouldClearMapSelectionOnPress(e.nativeEvent.action)) return;
          setSelectedBusinessId(null);
        }}
      >
        {userPos && Number.isFinite(userPos.lat) && Number.isFinite(userPos.lng) && radiusKm > 0 ? (
          <Circle
            center={{ latitude: userPos.lat, longitude: userPos.lng }}
            radius={radiusKm * 1000}
            strokeColor="rgba(17,17,17,0.35)"
            fillColor="rgba(17,17,17,0.06)"
          />
        ) : null}
        {markers
          .filter((m) => m.live)
          .map((m) => (
            <LiveDealHaloCircles
              key={`halo-${m.id}`}
              center={{ latitude: m.lat, longitude: m.lng }}
              pulse={livePulse}
            />
          ))}
        {userPos && Number.isFinite(userPos.lat) && Number.isFinite(userPos.lng) ? (
          <Marker coordinate={{ latitude: userPos.lat, longitude: userPos.lng }} tracksViewChanges={false} zIndex={1000}>
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                backgroundColor: "#3b82f6",
                borderWidth: 3,
                borderColor: "#fff",
              }}
            />
          </Marker>
        ) : null}
        {markers.map((m) =>
          renderBusinessMarker({
            marker: m,
            selectedBusinessId,
            deals,
            setSelectedBusinessId,
            router,
          }),
        )}
      </MapView>
      {mapReady ? null : (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,0.72)",
          }}
        >
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      )}

      {loading || markers.length > 0 ? null : (
        <View
          style={{
            position: "absolute",
            left: horizontal,
            right: horizontal,
            top: "28%",
            pointerEvents: "none",
          }}
        >
          <EmptyState title={t("consumerMap.emptyMarkersTitle")} message={t("consumerMap.emptyMarkersBody")} />
        </View>
      )}
      {selectedBusiness ? (
        <View
          style={{
            position: "absolute",
            left: horizontal,
            right: horizontal,
            bottom: Spacing.lg,
          }}
        >
          <Pressable
            onPress={() =>
              router.push((previewDeal ? `/deal/${previewDeal.id}` : `/business/${selectedBusiness.id}`) as Href)
            }
            accessibilityRole="button"
            style={{
              borderRadius: 24,
              backgroundColor: "#fff",
              overflow: "hidden",
              boxShadow: "0px 10px 20px rgba(0,0,0,0.16)",
              elevation: 10,
            }}
          >
            {previewPosterUri ? (
              <Image
                source={{ uri: previewPosterUri }}
                style={{ width: "100%", height: 146 }}
                contentFit="cover"
                transition={250}
              />
            ) : (
              <View style={{ width: "100%", height: 120, backgroundColor: "#f4f4f5" }} />
            )}
            <View style={{ padding: Spacing.lg }}>
              <Text style={{ fontSize: 12, fontWeight: "700", opacity: 0.62, textTransform: "uppercase" }}>
                {selectedBusiness.name}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 19, fontWeight: "800", lineHeight: 24 }}>
                {previewDeal?.title ?? selectedBusiness.name}
              </Text>
              {typeof previewDeal?.price === "number" ? (
                <Text style={{ marginTop: 6, fontSize: 18, fontWeight: "800", color: Colors.light.primary }}>
                  ${previewDeal.price.toFixed(2)}
                </Text>
              ) : null}
              {selectedBusiness.location ? (
                <Text style={{ marginTop: 6, fontSize: 13, opacity: 0.6 }} numberOfLines={1}>
                  {selectedBusiness.location}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function renderBusinessMarker({
  marker,
  selectedBusinessId,
  deals,
  setSelectedBusinessId,
  router,
}: {
  marker: MarkerWithLive;
  selectedBusinessId: string | null;
  deals: DealLite[];
  setSelectedBusinessId: (id: string | null) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const isSelected = selectedBusinessId === marker.id;
  const markerBg = isSelected || marker.live ? Colors.light.primary : "#404040";
  const markerBorderColor = getMarkerBorderColor(isSelected, marker.live);
  return (
    <Marker
      key={marker.id}
      coordinate={{ latitude: marker.lat, longitude: marker.lng }}
      tracksViewChanges={false}
      zIndex={marker.live ? 10 : 5}
      stopPropagation={Platform.OS === "ios"}
      onPress={() =>
        handleBusinessMarkerPress({
          markerId: marker.id,
          selectedBusinessId,
          deals,
          setSelectedBusinessId,
          router,
        })
      }
    >
      <View
        style={{
          minWidth: 28,
          height: 28,
          borderRadius: 14,
          paddingHorizontal: 7,
          backgroundColor: markerBg,
          borderWidth: marker.live ? 2 : 1,
          borderColor: markerBorderColor,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MaterialIcons name={marker.live ? "local-fire-department" : "storefront"} size={13} color="#fff" />
      </View>
    </Marker>
  );
}

function getMarkerBorderColor(isSelected: boolean, isLive: boolean) {
  if (isSelected) return "#ffd9a8";
  if (isLive) return "rgba(255,255,255,0.95)";
  return "#a3a3a3";
}

function handleBusinessMarkerPress({
  markerId,
  selectedBusinessId,
  deals,
  setSelectedBusinessId,
  router,
}: {
  markerId: string;
  selectedBusinessId: string | null;
  deals: DealLite[];
  setSelectedBusinessId: (id: string | null) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const liveDeal = pickPreviewDeal(deals, markerId, isDealActiveNow);
  const outcome = resolveMarkerTapOutcome({
    tappedBusinessId: markerId,
    selectedBusinessId,
    liveDealId: liveDeal?.id ?? null,
  });
  setSelectedBusinessId(outcome.nextSelectedBusinessId);
  if (outcome.href) {
    router.push(outcome.href as Href);
  }
}

function renderMapBody({
  loading,
  androidMapsOk,
  t,
  horizontal,
  mapCanvas,
}: {
  loading: boolean;
  androidMapsOk: boolean;
  t: (key: string) => string;
  horizontal: number;
  mapCanvas: ReactNode;
}) {
  if (loading) return renderMapLoading(t);
  if (!androidMapsOk) return renderAndroidMapsUnavailable(t, horizontal);
  return mapCanvas;
}

export default function MapScreenNative() { // NOSONAR - orchestration screen coordinates fetch, map, overlays, and navigation.
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal } = useScreenInsets("tab");
  const androidMapsOk =
    Platform.OS !== "android" || Boolean(Constants.expoConfig?.extra?.androidMapsKeyConfigured);
  const [mode, setMode] = useState<"all" | "live">("all");
  const [businesses, setBusinesses] = useState<MappableBusiness[]>([]);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  /** Map center / radius circle — may be ZIP centroid or GPS. */
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  /** Device blue dot only when GPS + permission; never for ZIP-only mode. */
  const [showDeviceBlueDot, setShowDeviceBlueDot] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(3);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);
  const lastCameraFitSignatureRef = useRef<string | null>(null);
  const livePulse = useLiveDealPulse();

  const loadMapData = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    setDataError(null);
    try {
      const payload = await fetchMapDataPayload(t);
      setRadiusMiles(payload.radiusMiles);
      setUserPos(payload.userPos);
      setShowDeviceBlueDot(payload.showDeviceBlueDot);
      setBusinesses(payload.businesses);
      if (payload.dealsFetchFailed) {
        setDataError(t("consumerMap.dataError"));
      } else {
        setDeals(payload.deals);
      }
    } catch (error) {
      devWarn("[map] loadMapData failed", error);
      setDataError(t("consumerMap.dataError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void loadMapData();
    }, [loadMapData]),
  );

  const liveByBusiness = useMemo(() => {
    return deriveLiveBusinessIds(
      deals.map((deal) => ({ business_id: deal.business_id, live: isDealActiveNow(deal) })),
    );
  }, [deals]);

  const markers = useMemo(() => {
    return businesses
      .map((b) => {
        const live = liveByBusiness.has(b.id);
        if (mode === "live" && !live) return null;
        return { ...b, live };
      })
      .filter(Boolean) as (MappableBusiness & { live: boolean })[];
  }, [businesses, liveByBusiness, mode]);

  const selectedBusiness = useMemo(
    () => markers.find((m) => m.id === selectedBusinessId) ?? null,
    [markers, selectedBusinessId],
  );

  const previewDeal = useMemo(() => {
    if (!selectedBusiness) return null;
    return pickPreviewDeal(deals, selectedBusiness.id, isDealActiveNow);
  }, [deals, selectedBusiness]);

  const initialRegion = useMemo((): Region => {
    if (userPos && Number.isFinite(userPos.lat) && Number.isFinite(userPos.lng)) {
      return safeRegion(userPos, 0.12, 0.12);
    }
    if (markers[0]) {
      return safeRegion({ lat: markers[0].lat, lng: markers[0].lng }, 0.25, 0.25);
    }
    return safeRegion(DALLAS_FALLBACK, 0.35, 0.35);
  }, [userPos, markers]);

  const radiusKm = milesToKm(Number.isFinite(radiusMiles) ? radiusMiles : 3);
  const showUserLocationDot = showDeviceBlueDot && !!userPos;
  const previewPosterUri =
    previewDeal ? resolveDealPosterDisplayUri(previewDeal.poster_url, previewDeal.poster_storage_path) : null;
  const subtitleText = mode === "live" ? t("consumerMap.subtitleLive") : t("consumerMap.subtitleAll");
  const mapCanvas = renderMapCanvas({
    horizontal,
    loadMapData,
    mapRef,
    initialRegion,
    showUserLocationDot,
    setMapReady,
    setSelectedBusinessId,
    userPos,
    radiusKm,
    markers,
    livePulse,
    selectedBusinessId,
    deals,
    router,
    mapReady,
    loading,
    t,
    selectedBusiness,
    previewDeal,
    previewPosterUri,
  });

  // MVP impressions tracking for map:
  // - In `live` mode, log active live deals (what the marker set represents).
  // - Always log the specific deal shown in the bottom preview card.
  useEffect(() => {
    const liveDeals = mode === "live" ? deals.filter((d) => isDealActiveNow(d)) : [];
    const seen = new Set<string>();
    const previewId = previewDeal?.id;
    const previewBusinessId = previewDeal?.business_id;

    if (mode === "live") {
      for (const d of liveDeals) {
        seen.add(d.id);
        trackAppAnalyticsEvent({
          event_name: "deal_viewed",
          deal_id: d.id,
          business_id: d.business_id,
          context: { source: "map", view: "live_markers" },
        });
      }
    }

    if (previewId && !seen.has(previewId)) {
      trackAppAnalyticsEvent({
        event_name: "deal_viewed",
        deal_id: previewId,
        business_id: previewBusinessId,
        context: { source: "map", view: "preview_card" },
      });
    }
  }, [mode, deals, previewDeal?.id, previewDeal?.business_id]);

  /** initialRegion only applies on first paint; nudge camera once when data + map are ready. */
  useEffect(() => {
    if (!mapReady || !androidMapsOk) return;
    const hasUser = userPos && Number.isFinite(userPos.lat) && Number.isFinite(userPos.lng);
    const hasMarkers = markers.length > 0;
    if (!hasUser && !hasMarkers) return;
    const signature = buildMapCameraFitSignature({
      userPos: hasUser && userPos ? userPos : null,
      markers: markers.map((marker) => ({ id: marker.id, lat: marker.lat, lng: marker.lng })),
    });
    if (lastCameraFitSignatureRef.current === signature) return;
    const region = hasUser && userPos
      ? safeRegion({ lat: userPos.lat, lng: userPos.lng }, 0.12, 0.12)
      : safeRegion({ lat: markers[0].lat, lng: markers[0].lng }, 0.25, 0.25);
    mapRef.current?.animateToRegion(region, 480);
    lastCameraFitSignatureRef.current = signature;
  }, [mapReady, androidMapsOk, userPos, markers]);

  return (
    <View style={{ flex: 1, paddingTop: top }}>
      {banner ? (
        <View style={{ paddingHorizontal: horizontal, marginBottom: Spacing.sm }}>
          <Banner message={banner} tone="error" />
        </View>
      ) : null}
      {dataError ? (
        <View style={{ paddingHorizontal: horizontal, marginBottom: Spacing.sm }}>
          <Banner message={dataError} tone="error" />
        </View>
      ) : null}
      <View style={{ paddingHorizontal: horizontal, marginBottom: Spacing.sm }}>
        <Text style={{ fontSize: 22, fontWeight: "800", letterSpacing: -0.2 }}>{t("consumerMap.title")}</Text>
        <Text style={{ marginTop: 4, fontSize: 13, opacity: 0.58, lineHeight: 18 }}>{subtitleText}</Text>
      </View>
      {androidMapsOk ? (
        <View style={{ paddingHorizontal: horizontal, marginBottom: Spacing.md, flexDirection: "row", gap: Spacing.sm }}>
          <Pressable
            onPress={() => setMode("all")}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === "all" }}
            accessibilityLabel={t("consumerMap.toggleAll")}
            accessibilityHint={t("consumerMap.a11yToggleAllHint")}
            style={{
              flex: 1,
              minHeight: 48,
              paddingVertical: Spacing.md,
              paddingHorizontal: Spacing.sm,
              borderRadius: 14,
              backgroundColor: mode === "all" ? "#111" : "#fff",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: mode === "all" ? 0 : 1,
              borderColor: "#e4e4e7",
            }}
          >
            <Text style={{ fontWeight: "700", fontSize: 14, color: mode === "all" ? "#fff" : "#27272a", textAlign: "center" }}>
              {t("consumerMap.toggleAll")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode("live")}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === "live" }}
            accessibilityLabel={t("consumerMap.toggleLive")}
            accessibilityHint={t("consumerMap.a11yToggleLiveHint")}
            style={{
              flex: 1,
              minHeight: 48,
              paddingVertical: Spacing.md,
              paddingHorizontal: Spacing.sm,
              borderRadius: 14,
              backgroundColor: mode === "live" ? "#111" : "#fff",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: mode === "live" ? 0 : 1,
              borderColor: "#e4e4e7",
            }}
          >
            <Text style={{ fontWeight: "700", fontSize: 14, color: mode === "live" ? "#fff" : "#27272a", textAlign: "center" }}>
              {t("consumerMap.toggleLive")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {renderMapBody({ loading, androidMapsOk, t, horizontal, mapCanvas })}
    </View>
  );
}
