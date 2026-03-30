import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { LiveDealHaloCircles, useLiveDealPulse } from "@/components/map/live-deal-halo";

type Biz = {
  id: string;
  name: string;
  location: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

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

function parseCoord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = typeof lat === "number" ? lat : lat != null ? Number(lat) : NaN;
  const ln = typeof lng === "number" ? lng : lng != null ? Number(lng) : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

function safeRegion(center: { lat: number; lng: number }, latitudeDelta: number, longitudeDelta: number): Region {
  const lat = Math.min(90, Math.max(-90, center.lat));
  const lng = Math.min(180, Math.max(-180, center.lng));
  const dLat = Number.isFinite(latitudeDelta) && latitudeDelta > 0 ? Math.min(80, Math.max(0.02, latitudeDelta)) : 0.12;
  const dLng = Number.isFinite(longitudeDelta) && longitudeDelta > 0 ? Math.min(80, Math.max(0.02, longitudeDelta)) : 0.12;
  return { latitude: lat, longitude: lng, latitudeDelta: dLat, longitudeDelta: dLng };
}

/** Dallas–Fort Worth service area fallback when GPS and markers are unavailable. */
const DALLAS_FALLBACK = { lat: 32.7767, lng: -96.797 };

export default function MapScreenNative() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal } = useScreenInsets("tab");
  const androidMapsOk =
    Platform.OS !== "android" || Boolean(Constants.expoConfig?.extra?.androidMapsKeyConfigured);
  const [mode, setMode] = useState<"all" | "live">("all");
  const [businesses, setBusinesses] = useState<Biz[]>([]);
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
  const cameraFittedRef = useRef(false);
  const livePulse = useLiveDealPulse();

  const loadMapData = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    setDataError(null);
    try {
      const prefs = await getConsumerPreferences();
      setRadiusMiles(prefs.radiusMiles);
      const coords = await resolveConsumerCoordinates(prefs);
      if (coords) {
        setUserPos({ lat: coords.lat, lng: coords.lng });
        setShowDeviceBlueDot(coords.showsDeviceLocationBlueDot);
      } else {
        setUserPos(null);
        setShowDeviceBlueDot(false);
      }

      const { data: bz, error: eb } = await supabase
        .from("businesses")
        .select("id,name,location,latitude,longitude")
        .order("name", { ascending: true })
        .limit(400);
      if (eb) {
        logPostgrestError("map screen businesses", eb);
        setBusinesses([]);
        setDataError(t("consumerMap.dataError"));
      } else {
        setBusinesses((bz ?? []) as Biz[]);
      }

      const { data: dz, error: ed } = await supabase
        .from("deals")
        .select(
          "id,title,description,poster_url,poster_storage_path,price,max_claims,business_id,end_time,start_time,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone",
        )
        .eq("is_active", true)
        .gte("end_time", new Date().toISOString())
        .limit(200);
      if (ed) {
        logPostgrestError("map screen deals", ed);
        setDeals([]);
        setDataError(t("consumerMap.dataError"));
      } else {
        setDeals((dz ?? []) as DealLite[]);
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
    const m = new Set<string>();
    for (const d of deals) {
      if (isDealActiveNow(d)) m.add(d.business_id);
    }
    return m;
  }, [deals]);

  const markers = useMemo(() => {
    const withCoords = businesses
      .map((b) => {
        const c = parseCoord(b.latitude, b.longitude);
        if (!c) return null;
        const live = liveByBusiness.has(b.id);
        if (mode === "live" && !live) return null;
        return { ...b, ...c, live };
      })
      .filter(Boolean) as (Biz & { lat: number; lng: number; live: boolean })[];
    return withCoords;
  }, [businesses, liveByBusiness, mode]);

  const selectedBusiness = useMemo(
    () => markers.find((m) => m.id === selectedBusinessId) ?? null,
    [markers, selectedBusinessId],
  );

  const previewDeal = useMemo(() => {
    if (!selectedBusiness) return null;
    const businessDeals = deals.filter((d) => d.business_id === selectedBusiness.id);
    if (businessDeals.length === 0) return null;
    const liveDeal = businessDeals.find((d) => isDealActiveNow(d)) ?? null;
    return liveDeal ?? businessDeals.sort((a, b) => +new Date(a.end_time) - +new Date(b.end_time))[0];
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
    if (cameraFittedRef.current) return;
    const hasUser = userPos && Number.isFinite(userPos.lat) && Number.isFinite(userPos.lng);
    const hasMarkers = markers.length > 0;
    if (!hasUser && !hasMarkers) return;
    const region = hasUser
      ? safeRegion({ lat: userPos!.lat, lng: userPos!.lng }, 0.12, 0.12)
      : safeRegion({ lat: markers[0]!.lat, lng: markers[0]!.lng }, 0.25, 0.25);
    mapRef.current?.animateToRegion(region, 480);
    cameraFittedRef.current = true;
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
        <Text style={{ marginTop: 4, fontSize: 13, opacity: 0.58, lineHeight: 18 }}>
          {mode === "live" ? t("consumerMap.subtitleLive") : t("consumerMap.subtitleAll")}
        </Text>
      </View>
      {androidMapsOk ? (
        <View style={{ paddingHorizontal: horizontal, marginBottom: Spacing.md, flexDirection: "row", gap: Spacing.sm }}>
          <Pressable
            onPress={() => setMode("all")}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === "all" }}
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

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
          <Text style={{ marginTop: Spacing.md, opacity: 0.65, fontSize: 13 }}>{t("consumerMap.subtitleAll")}</Text>
        </View>
      ) : !androidMapsOk ? (
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: horizontal }}>
          <EmptyState
            title={t("consumerMap.androidMapsUnavailableTitle")}
            message={t("consumerMap.androidMapsUnavailableBody")}
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <Pressable
            onPress={() => void loadMapData()}
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
              if (e.nativeEvent.action === "marker-press") return;
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
            {markers.map((m) => (
              <Marker
                key={m.id}
                coordinate={{ latitude: m.lat, longitude: m.lng }}
                tracksViewChanges={false}
                zIndex={m.live ? 10 : 5}
                stopPropagation={Platform.OS === "ios"}
                onPress={() => setSelectedBusinessId(m.id)}
              >
                <View
                  style={{
                    minWidth: 28,
                    height: 28,
                    borderRadius: 14,
                    paddingHorizontal: 7,
                    backgroundColor:
                      selectedBusinessId === m.id ? Colors.light.primary : m.live ? Colors.light.primary : "#404040",
                    borderWidth: m.live ? 2 : 1,
                    borderColor:
                      selectedBusinessId === m.id ? "#ffd9a8" : m.live ? "rgba(255,255,255,0.95)" : "#a3a3a3",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MaterialIcons name={m.live ? "local-fire-department" : "storefront"} size={13} color="#fff" />
                </View>
              </Marker>
            ))}
          </MapView>
          {!mapReady ? (
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
          ) : null}

          {!loading && markers.length === 0 ? (
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
          ) : null}
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
                  {previewDeal?.price != null ? (
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
      )}
    </View>
  );
}
