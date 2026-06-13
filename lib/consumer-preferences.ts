import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "twoforone_consumer_v1_";

export type ConsumerLocationMode = "gps" | "zip";

/** How we decide which deals trigger local notifications (extensible for future filters). */
export type ConsumerNotificationMode = "all_nearby" | "favorites_only";

export const CONSUMER_RADIUS_MILES_OPTIONS = [1, 3, 5, 10] as const;
export type ConsumerRadiusMiles = (typeof CONSUMER_RADIUS_MILES_OPTIONS)[number];

// Matches the hosted consumer push preference schema and v1 onboarding spec.
export const DEFAULT_RADIUS_MILES: ConsumerRadiusMiles = 3;

export type ConsumerNotificationPrefsV1 = {
  v: 1;
  mode: ConsumerNotificationMode;
  /** Reserved for future filters (e.g. BOGO-only). */
  categoryTags?: string[];
};

export type ConsumerPreferences = {
  onboardingComplete: boolean;
  locationMode: ConsumerLocationMode;
  zipCode: string;
  radiusMiles: ConsumerRadiusMiles;
  notificationPrefs: ConsumerNotificationPrefsV1;
  /** Last resolved coords for notifications / sorting (WGS84). */
  lastLatitude: number | null;
  lastLongitude: number | null;
};

const DEFAULTS: ConsumerPreferences = {
  onboardingComplete: false,
  locationMode: "gps",
  zipCode: "",
  radiusMiles: DEFAULT_RADIUS_MILES,
  notificationPrefs: { v: 1, mode: "all_nearby" },
  lastLatitude: null,
  lastLongitude: null,
};

async function getJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function setJson(key: string, value: unknown) {
  await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export async function getConsumerPreferences(): Promise<ConsumerPreferences> {
  const [
    onboardingComplete,
    locationMode,
    zipCode,
    radiusMiles,
    notificationPrefs,
    lastLatitude,
    lastLongitude,
  ] = await Promise.all([
    AsyncStorage.getItem(PREFIX + "onboarding_complete"),
    AsyncStorage.getItem(PREFIX + "location_mode"),
    AsyncStorage.getItem(PREFIX + "zip"),
    AsyncStorage.getItem(PREFIX + "radius_miles"),
    getJson<ConsumerNotificationPrefsV1>("notification_prefs"),
    AsyncStorage.getItem(PREFIX + "last_lat"),
    AsyncStorage.getItem(PREFIX + "last_lng"),
  ]);

  const r = radiusMiles != null ? Number(radiusMiles) : DEFAULT_RADIUS_MILES;
  const radius: ConsumerRadiusMiles = CONSUMER_RADIUS_MILES_OPTIONS.includes(r as ConsumerRadiusMiles)
    ? (r as ConsumerRadiusMiles)
    : DEFAULT_RADIUS_MILES;

  return {
    onboardingComplete: onboardingComplete === "true",
    locationMode: locationMode === "zip" ? "zip" : "gps",
    zipCode: zipCode ?? "",
    radiusMiles: radius,
    notificationPrefs: notificationPrefs && notificationPrefs.v === 1 ? notificationPrefs : DEFAULTS.notificationPrefs,
    lastLatitude: lastLatitude != null && lastLatitude !== "" ? Number(lastLatitude) : null,
    lastLongitude: lastLongitude != null && lastLongitude !== "" ? Number(lastLongitude) : null,
  };
}

export async function setOnboardingComplete(complete: boolean) {
  await AsyncStorage.setItem(PREFIX + "onboarding_complete", complete ? "true" : "false");
}

export async function setConsumerLocationMode(mode: ConsumerLocationMode) {
  await AsyncStorage.setItem(PREFIX + "location_mode", mode);
}

export async function setConsumerZipCode(zip: string) {
  await AsyncStorage.setItem(PREFIX + "zip", zip.trim());
}

export async function setConsumerRadiusMiles(miles: ConsumerRadiusMiles) {
  await AsyncStorage.setItem(PREFIX + "radius_miles", String(miles));
}

export async function setConsumerNotificationPrefs(prefs: ConsumerNotificationPrefsV1) {
  await setJson("notification_prefs", prefs);
}

export async function setLastKnownConsumerCoords(lat: number, lng: number) {
  await AsyncStorage.setItem(PREFIX + "last_lat", String(lat));
  await AsyncStorage.setItem(PREFIX + "last_lng", String(lng));
}

export async function getLastKnownConsumerCoords(): Promise<{ lat: number; lng: number } | null> {
  const [latRaw, lngRaw] = await Promise.all([
    AsyncStorage.getItem(PREFIX + "last_lat"),
    AsyncStorage.getItem(PREFIX + "last_lng"),
  ]);
  if (latRaw == null || lngRaw == null) return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function milesToKm(miles: number) {
  return miles * 1.60934;
}
