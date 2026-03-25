import * as Location from "expo-location";
import type { ConsumerPreferences } from "./consumer-preferences";
import { geocodeUsZip } from "./us-zip-geocode";

export type ResolvedConsumerCoords = {
  lat: number;
  lng: number;
  source: "gps" | "zip_geocode";
  /**
   * Only true when position came from device GPS with foreground permission.
   * MapView `showsUserLocation` must stay false for ZIP-based coordinates — otherwise Android can crash without location permission.
   */
  showsDeviceLocationBlueDot: boolean;
};

/**
 * Resolve consumer coordinates from prefs (GPS permission + current position, or ZIP geocode).
 * Returns null if unavailable (caller may show banner or prompt).
 */
export async function resolveConsumerCoordinates(
  prefs: ConsumerPreferences,
): Promise<ResolvedConsumerCoords | null> {
  if (prefs.locationMode === "zip") {
    const r = await geocodeUsZip(prefs.zipCode);
    if (!r.ok) return null;
    return {
      lat: r.lat,
      lng: r.lng,
      source: "zip_geocode",
      showsDeviceLocationBlueDot: false,
    };
  }

  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") return null;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      source: "gps",
      showsDeviceLocationBlueDot: true,
    };
  } catch {
    return null;
  }
}
