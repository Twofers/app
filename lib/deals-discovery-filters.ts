/** Pure helpers for Deals search + approximate “near me” (text / geocode hints). Covered by unit tests. */

export function normalizeSearch(q: string): string {
  return q.trim().toLowerCase();
}

export type DealForDiscovery = {
  title: string | null;
  description: string | null;
  businesses?: {
    name: string | null;
    category: string | null;
    location: string | null;
  } | null;
};

export function dealMatchesSearch(deal: DealForDiscovery, queryRaw: string): boolean {
  const q = normalizeSearch(queryRaw);
  if (!q) return true;
  const hay = [
    deal.title,
    deal.description,
    deal.businesses?.name,
    deal.businesses?.category,
    deal.businesses?.location,
  ]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export type GeocodePlace = {
  city?: string | null;
  region?: string | null;
  subregion?: string | null;
  district?: string | null;
  name?: string | null;
};

export function collectGeocodeHints(places: GeocodePlace[]): string[] {
  const set = new Set<string>();
  for (const p of places) {
    for (const key of ["city", "region", "subregion", "district", "name"] as const) {
      const v = p[key]?.trim();
      if (v && v.length >= 2) set.add(v.toLowerCase());
    }
  }
  return Array.from(set);
}

export function dealMatchesNearHints(deal: DealForDiscovery, hints: string[]): boolean {
  if (hints.length === 0) return true;
  const loc = (deal.businesses?.location ?? "").toLowerCase();
  const name = (deal.businesses?.name ?? "").toLowerCase();
  return hints.some((h) => loc.includes(h) || name.includes(h));
}
