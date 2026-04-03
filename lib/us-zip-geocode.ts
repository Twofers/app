import * as Location from "expo-location";
import { isValidUsZipFormat, normalizeUsZipInput, parseUsZipFiveDigits } from "./us-zip";

const ZIP_LOG = "[consumer-zip]";

export type ZipGeocodeFailure =
  | "invalid_format"
  | "expo_empty"
  | "http_error"
  | "parse_error"
  | "no_coordinates";

export type ZipGeocodeResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; failure: ZipGeocodeFailure };

/**
 * Resolve a US ZIP string to coordinates: platform geocoder first, then Zippopotam (HTTPS) fallback.
 * Logs validation, empty results, HTTP status, and parse issues for support.
 */
export async function geocodeUsZip(raw: string): Promise<ZipGeocodeResult> {
  const normalized = normalizeUsZipInput(raw);
  if (!isValidUsZipFormat(normalized)) {
    if (__DEV__) console.warn(ZIP_LOG, "validation_fail", { normalizedPreview: normalized.slice(0, 16) });
    return { ok: false, failure: "invalid_format" };
  }
  const zip5 = parseUsZipFiveDigits(normalized);
  if (!zip5) {
    if (__DEV__) console.warn(ZIP_LOG, "parse_five_fail", { normalized });
    return { ok: false, failure: "invalid_format" };
  }

  try {
    const expo = await Location.geocodeAsync(`${zip5}, USA`);
    const first = expo[0];
    if (first && Number.isFinite(first.latitude) && Number.isFinite(first.longitude)) {
      if (__DEV__) console.warn(ZIP_LOG, "expo_ok", { zip5, lat: first.latitude, lng: first.longitude });
      return { ok: true, lat: first.latitude, lng: first.longitude };
    }
    if (__DEV__) console.warn(ZIP_LOG, "expo_empty", { zip5, resultCount: expo?.length ?? 0 });
  } catch (e) {
    if (__DEV__) console.warn(ZIP_LOG, "expo_error", { zip5, error: String(e) });
  }

  try {
    const url = `https://api.zippopotam.us/us/${encodeURIComponent(zip5)}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (__DEV__) console.warn(ZIP_LOG, "zippopotam_http", { zip5, status: res.status });
      return { ok: false, failure: res.status >= 500 ? "http_error" : "no_coordinates" };
    }
    const j = (await res.json()) as { places?: { latitude?: string; longitude?: string }[] };
    const p = j.places?.[0];
    const lat = p?.latitude != null ? Number(p.latitude) : NaN;
    const lng = p?.longitude != null ? Number(p.longitude) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      if (__DEV__) console.warn(ZIP_LOG, "zippopotam_ok", { zip5, lat, lng });
      return { ok: true, lat, lng };
    }
    if (__DEV__) console.warn(ZIP_LOG, "zippopotam_no_coords", { zip5 });
    return { ok: false, failure: "no_coordinates" };
  } catch (e) {
    if (__DEV__) console.warn(ZIP_LOG, "zippopotam_network", { zip5, error: String(e) });
    return { ok: false, failure: "http_error" };
  }
}
