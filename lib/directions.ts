import { Linking, Platform } from "react-native";

/**
 * Guarded "open maps directions" helper, extracted from the pattern in
 * app/business/[id].tsx (canOpenDirections / openDirections): prefer numeric
 * coordinates, fall back to a name+address text query, try the platform-native
 * maps URL then the Google Maps web URL, and never throw on malformed input.
 */
export type DirectionsTarget = {
  name?: string | null;
  address?: string | null;
  location?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

function coord(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (v != null) return Number(v);
  return NaN;
}

/** True when the target has usable coordinates or a non-empty address/location. */
export function hasDirectionsTarget(target: DirectionsTarget | null | undefined): boolean {
  if (!target) return false;
  if (Number.isFinite(coord(target.latitude)) && Number.isFinite(coord(target.longitude))) return true;
  return !!(target.address?.trim() || target.location?.trim());
}

export type OpenDirectionsResult = "opened" | "no-target" | "failed";

export async function openDirectionsToTarget(
  target: DirectionsTarget | null | undefined,
): Promise<OpenDirectionsResult> {
  if (!target) return "no-target";
  const lat = coord(target.latitude);
  const lng = coord(target.longitude);
  const label = (target.name ?? "Business").trim() || "Business";
  let nativeUrl: string;
  let fallbackUrl: string;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const encodedLabel = encodeURIComponent(label);
    nativeUrl = Platform.select({
      ios: `maps://?q=${encodedLabel}&ll=${lat},${lng}`,
      android: `geo:0,0?q=${lat},${lng}(${encodedLabel})`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    })!;
    fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  } else {
    const area = (target.address ?? target.location)?.trim();
    if (!area) return "no-target";
    const q = encodeURIComponent(`${label} ${area}`.trim());
    nativeUrl = Platform.select({
      ios: `maps://?q=${q}`,
      android: `geo:0,0?q=${q}`,
      default: `https://www.google.com/maps/search/?api=1&query=${q}`,
    })!;
    fallbackUrl = `https://www.google.com/maps/search/?api=1&query=${q}`;
  }
  try {
    if (await Linking.canOpenURL(nativeUrl)) {
      await Linking.openURL(nativeUrl);
      return "opened";
    }
    if (nativeUrl !== fallbackUrl && (await Linking.canOpenURL(fallbackUrl))) {
      await Linking.openURL(fallbackUrl);
      return "opened";
    }
    return "failed";
  } catch {
    return "failed";
  }
}
