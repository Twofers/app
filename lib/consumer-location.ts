import * as Location from "expo-location";
import type { ConsumerPreferences } from "./consumer-preferences";

export type ResolvedConsumerCoords = {
  lat: number;
  lng: number;
  source: "gps" | "zip_geocode";
};

/**
 * Resolve consumer coordinates from prefs (GPS permission + current position, or ZIP geocode).
 * Returns null if unavailable (caller may show banner or prompt).
 */
export async function resolveConsumerCoordinates(
  prefs: ConsumerPreferences,
): Promise<ResolvedConsumerCoords | null> {
  if (prefs.locationMode === "zip") {
    const zip = prefs.zipCode.trim();
    if (!zip) return null;
    try {
      const results = await Location.geocodeAsync(`${zip}, USA`);
      const first = results[0];
      if (first && Number.isFinite(first.latitude) && Number.isFinite(first.longitude)) {
        return { lat: first.latitude, lng: first.longitude, source: "zip_geocode" };
      }
    } catch {
      return null;
    }
    return null;
  }

  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") return null;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      source: "gps",
    };
  } catch {
    return null;
  }
}
