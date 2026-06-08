export type BusinessDetailsSource = "google_places" | "manual";

export type BusinessLookupResult = {
  name: string;
  formatted_address: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  category: string;
  hours_text: string;
  website: string;
  place_id: string;
  source: "google_places";
};

const VERIFIED_BUSINESS_LOOKUP_SOURCE: BusinessLookupResult["source"] = "google_places";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeBusinessLookupResult(value: unknown): BusinessLookupResult | null {
  const row = asRecord(value);
  if (!row || row.source !== VERIFIED_BUSINESS_LOOKUP_SOURCE) return null;

  const name = cleanString(row.name);
  const formatted_address = cleanString(row.formatted_address);
  const place_id = cleanString(row.place_id);

  if (!name || !formatted_address || !place_id) return null;

  return {
    name,
    formatted_address,
    place_id,
    phone: cleanString(row.phone),
    lat: cleanNumberOrNull(row.lat),
    lng: cleanNumberOrNull(row.lng),
    category: cleanString(row.category),
    hours_text: cleanString(row.hours_text),
    website: cleanString(row.website),
    source: VERIFIED_BUSINESS_LOOKUP_SOURCE,
  };
}

export function normalizeBusinessLookupResults(data: unknown): BusinessLookupResult[] {
  const body = asRecord(data);
  const rows = Array.isArray(body?.results) ? body.results : [];
  return rows
    .map((row) => normalizeBusinessLookupResult(row))
    .filter((row): row is BusinessLookupResult => row !== null);
}

export function isVerifiedBusinessLookupResult(value: unknown): value is BusinessLookupResult {
  return normalizeBusinessLookupResult(value) !== null;
}

export function resolveBusinessDetailsSource(
  result: BusinessLookupResult | null | undefined,
): BusinessDetailsSource {
  return result ? result.source : "manual";
}
