import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import MapView, { Circle, Marker, type Region } from "react-native-maps";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { logPostgrestError } from "@/lib/supabase-client-log";
import { isDealActiveNow } from "@/lib/deal-time";
import { getConsumerPreferences, milesToKm } from "@/lib/consumer-preferences";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";

type Biz = {
  id: string;
  name: string;
  location: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

type DealLite = {
  id: string;
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

export default function MapScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const [mode, setMode] = useState<"all" | "live">("all");
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  /** Map center / radius circle — may be ZIP centroid or GPS. */
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  /** Device blue dot only when GPS + permission; never for ZIP-only mode. */
  const [showDeviceBlueDot, setShowDeviceBlueDot] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(3);

  const loadMapData = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    setDataError(null);
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
        "id,business_id,end_time,start_time,is_recurring,days_of_week,window_start_minutes,window_end_minutes,timezone",
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
    setLoading(false);
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
  const showUserLocationDot = Platform.OS !== "web" && showDeviceBlueDot && !!userPos;

  if (Platform.OS === "web") {
    return (
      <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1, paddingBottom: listBottom }}>
        <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("consumerMap.title")}</Text>
        <Text style={{ marginTop: Spacing.md, opacity: 0.75, lineHeight: 22 }}>{t("consumerMap.webFallback")}</Text>
      </View>
    );
  }

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

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <MapView style={{ flex: 1 }} initialRegion={initialRegion} showsUserLocation={showUserLocationDot}>
            {userPos && Number.isFinite(userPos.lat) && Number.isFinite(userPos.lng) && radiusKm > 0 ? (
              <Circle
                center={{ latitude: userPos.lat, longitude: userPos.lng }}
                radius={radiusKm * 1000}
                strokeColor="rgba(17,17,17,0.35)"
                fillColor="rgba(17,17,17,0.06)"
              />
            ) : null}
            {markers.map((m) => (
              <Marker
                key={m.id}
                coordinate={{ latitude: m.lat, longitude: m.lng }}
                tracksViewChanges={false}
                onPress={() => router.push(`/business/${m.id}` as Href)}
              >
                <View
                  style={{
                    padding: 8,
                    borderRadius: 20,
                    backgroundColor: m.live ? "#166534" : "#404040",
                    borderWidth: m.live ? 3 : 0,
                    borderColor: "#86efac",
                  }}
                >
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#fff" }} />
                </View>
              </Marker>
            ))}
          </MapView>

          {!loading && markers.length === 0 ? (
            <View
              style={{
                position: "absolute",
                left: horizontal,
                right: horizontal,
                top: "28%",
              }}
              pointerEvents="none"
            >
              <EmptyState title={t("consumerMap.emptyMarkersTitle")} message={t("consumerMap.emptyMarkersBody")} />
            </View>
          ) : null}

        </View>
      )}
    </View>
  );
}
