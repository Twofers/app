import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import i18n from "./i18n/config";
import { supabase } from "./supabase";
import { getConsumerPreferences, milesToKm } from "./consumer-preferences";
import { haversineKm } from "./geo";

const ALERTS_KEY = "deal_alerts_enabled";
const LAST_SEEN_KEY = "last_seen_deals_at";

export async function getAlertsEnabled(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(ALERTS_KEY);
  return val === "true";
}

export async function setAlertsEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(ALERTS_KEY, enabled ? "true" : "false");
}

export async function getLastSeen(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_SEEN_KEY);
}

export async function setLastSeen(value: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_SEEN_KEY, value);
}

function bizLatLng(b: { latitude: unknown; longitude: unknown } | null | undefined): { lat: number; lng: number } | null {
  if (!b) return null;
  const lat = typeof b.latitude === "number" ? b.latitude : b.latitude != null ? Number(b.latitude) : NaN;
  const lng = typeof b.longitude === "number" ? b.longitude : b.longitude != null ? Number(b.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * When notification mode is "favorites only", uses favorite businesses (any distance).
 * When "all nearby", counts new deals within the saved radius from last known coords.
 * Call on focus after loading deals/favorites.
 */
export async function syncConsumerDealNotifications({
  userId,
  favoriteBusinessIds,
}: {
  userId: string | null;
  favoriteBusinessIds: string[];
}): Promise<void> {
  if (!userId) return;
  const alertsEnabled = await getAlertsEnabled();
  if (!alertsEnabled) return;

  const prefs = await getConsumerPreferences();
  const mode = prefs.notificationPrefs.mode;

  const lastSeen = await getLastSeen();
  const nowIso = new Date().toISOString();
  if (!lastSeen) {
    await setLastSeen(nowIso);
    return;
  }

  if (mode === "favorites_only") {
    if (favoriteBusinessIds.length === 0) {
      await setLastSeen(nowIso);
      return;
    }
    const { count, error } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .in("business_id", favoriteBusinessIds)
      .gt("created_at", lastSeen)
      .eq("is_active", true);

    await setLastSeen(nowIso);
    if (error) return;
    if (!count) return;

    const lng = i18n.language;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: String(i18n.t("pushTemplates.newDealsTitleFavorites", { lng })),
        body: String(i18n.t("pushTemplates.newDealsBody", { count, lng })),
        data: { path: "/(tabs)" },
      },
      trigger: null,
    });
    return;
  }

  // all_nearby — favorites still override distance for inclusion
  const lat = prefs.lastLatitude;
  const lng = prefs.lastLongitude;
  const radiusKm = milesToKm(prefs.radiusMiles);

  const { data: rows, error } = await supabase
    .from("deals")
    .select("id, business_id, businesses(latitude, longitude)")
    .gt("created_at", lastSeen)
    .eq("is_active", true)
    .limit(200);

  await setLastSeen(nowIso);
  if (error) return;

  const favSet = new Set(favoriteBusinessIds);
  let matchCount = 0;
  for (const row of rows ?? []) {
    const rawBiz = row.businesses as unknown;
    const b = (Array.isArray(rawBiz) ? rawBiz[0] : rawBiz) as
      | { latitude: unknown; longitude: unknown }
      | null
      | undefined;
    const coords = bizLatLng(b);
    const inFav = favSet.has(row.business_id as string);
    if (inFav) {
      matchCount += 1;
      continue;
    }
    if (lat == null || lng == null || !coords) continue;
    const km = haversineKm(lat, lng, coords.lat, coords.lng);
    if (km <= radiusKm) matchCount += 1;
  }

  if (matchCount === 0) return;

  const lang = i18n.language;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: String(i18n.t("pushTemplates.newDealsTitleNearby", { lng: lang })),
      body: String(i18n.t("pushTemplates.newDealsBody", { count: matchCount, lng: lang })),
      data: { path: "/(tabs)" },
    },
    trigger: null,
  });
}

/** @deprecated Use syncConsumerDealNotifications */
export async function checkForNewFavoriteDeals(params: {
  userId: string;
  favoriteBusinessIds: string[];
}): Promise<void> {
  await syncConsumerDealNotifications(params);
}
