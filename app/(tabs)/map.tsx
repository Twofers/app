import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";
import { isDealActiveNow } from "@/lib/deal-time";
import { useBusiness } from "@/hooks/use-business";
import { getConsumerPreferences, milesToKm } from "@/lib/consumer-preferences";
import { resolveConsumerCoordinates } from "@/lib/consumer-location";
import { haversineMiles } from "@/lib/geo";
import { BusinessRowCard } from "@/components/business-row-card";
import { Banner } from "@/components/ui/banner";

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
  return { lat: la, lng: ln };
}

export default function MapScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, listBottom } = useScreenInsets("tab");
  const { userId } = useBusiness();
  const [mode, setMode] = useState<"all" | "live">("all");
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [deals, setDeals] = useState<DealLite[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [radiusMiles, setRadiusMiles] = useState(3);

  const loadFavorites = useCallback(async () => {
    if (!userId) {
      setFavoriteIds([]);
      return;
    }
    const { data } = await supabase.from("favorites").select("business_id").eq("user_id", userId);
    setFavoriteIds((data ?? []).map((r) => r.business_id));
  }, [userId]);

  const loadMapData = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    const prefs = await getConsumerPreferences();
    setRadiusMiles(prefs.radiusMiles);
    const coords = await resolveConsumerCoordinates(prefs);
    setUserPos(coords);

    const { data: bz, error: eb } = await supabase
      .from("businesses")
      .select("id,name,location,latitude,longitude")
      .order("name", { ascending: true })
      .limit(400);
    if (eb) {
      setBanner(eb.message);
      setBusinesses([]);
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
      setDeals([]);
    } else {
      setDeals((dz ?? []) as DealLite[]);
    }
    await loadFavorites();
    setLoading(false);
  }, [loadFavorites]);

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

  const selected = selectedId ? businesses.find((b) => b.id === selectedId) : null;
  const selectedCoords = selected ? parseCoord(selected.latitude, selected.longitude) : null;
  const selectedLive = selected ? liveByBusiness.has(selected.id) : false;

  async function toggleFavorite(businessId: string) {
    if (!userId) {
      setBanner(t("dealDetail.errLoginFavorite"));
      return;
    }
    const isFav = favoriteIds.includes(businessId);
    const next = isFav ? favoriteIds.filter((id) => id !== businessId) : [...favoriteIds, businessId];
    setFavoriteIds(next);
    if (isFav) {
      await supabase.from("favorites").delete().eq("user_id", userId).eq("business_id", businessId);
    } else {
      const { error } = await supabase.from("favorites").insert({ user_id: userId, business_id: businessId });
      if (error) {
        setFavoriteIds(favoriteIds);
        setBanner(error.message);
      }
    }
  }

  const initialRegion = useMemo(() => {
    if (userPos) {
      return {
        latitude: userPos.lat,
        longitude: userPos.lng,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      };
    }
    if (markers[0]) {
      return {
        latitude: markers[0].lat,
        longitude: markers[0].lng,
        latitudeDelta: 0.25,
        longitudeDelta: 0.25,
      };
    }
    return {
      latitude: 39.8283,
      longitude: -98.5795,
      latitudeDelta: 40,
      longitudeDelta: 40,
    };
  }, [userPos, markers]);

  const radiusKm = milesToKm(radiusMiles);

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
          <MapView style={{ flex: 1 }} initialRegion={initialRegion} showsUserLocation={!!userPos}>
            {userPos ? (
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
                onPress={() => setSelectedId(m.id)}
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

          {selected && selectedCoords ? (
            <View
              style={{
                position: "absolute",
                left: horizontal,
                right: horizontal,
                bottom: listBottom,
                borderRadius: 18,
                backgroundColor: "#fff",
                padding: Spacing.md,
                shadowColor: "#000",
                shadowOpacity: 0.12,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
            >
              <BusinessRowCard
                name={selected.name}
                address={selected.location}
                hasLiveDeal={selectedLive}
                isFavorite={favoriteIds.includes(selected.id)}
                distanceLabel={
                  userPos
                    ? t("dealsBrowse.distanceAwayMiles", {
                        distance: haversineMiles(userPos.lat, userPos.lng, selectedCoords.lat, selectedCoords.lng).toFixed(1),
                      })
                    : undefined
                }
                onPress={() => router.push(`/business/${selected.id}` as Href)}
                onToggleFavorite={() => void toggleFavorite(selected.id)}
              />
              <Pressable
                onPress={() => setSelectedId(null)}
                style={{ marginTop: Spacing.sm, alignSelf: "center", padding: Spacing.sm }}
              >
                <Text style={{ fontWeight: "600", opacity: 0.55 }}>{t("consumerMap.dismissPreview")}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
