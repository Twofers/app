/**
 * Pure targeting logic for the weekly deal digest. Kept separate (and dependency-free)
 * so it can be unit-tested deterministically (see digest-targeting.test.ts) without
 * network or Deno-only imports.
 */

const R_KM = 6371;
/** Haversine distance in miles between two WGS84 points. */
export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return (R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / 1.60934;
}

export type DigestDeal = {
  business_id: string;
  lat: number | null;
  lng: number | null;
};

export type DigestConsumer = {
  user_id: string;
  /** Server mirror of the in-app deal-alerts opt-in. Required true to be targeted. */
  deal_alerts_enabled: boolean;
  /** 'all_nearby' | 'favorites_only' | 'none' (or anything else → treated as none). */
  notification_mode: string | null;
  lat: number | null;
  lng: number | null;
  radius_miles: number | null;
  favorite_business_ids: string[];
};

const DEFAULT_RADIUS_MILES = 3;

function isFiniteNum(n: number | null): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * For each consumer, count how many of the given recent deals they should be told
 * about, honoring:
 *  - deal_alerts_enabled (opt-in) and notification_mode ('none' → skipped)
 *  - radius + stored location (all_nearby)
 *  - favorites: 'favorites_only' counts only favorited shops; 'all_nearby' also
 *    always includes favorited shops regardless of distance (override)
 *
 * Pure and total: never throws, ignores rows with missing/non-finite coordinates.
 * Returns only users with count > 0.
 */
export function computeDigestCounts(
  deals: DigestDeal[],
  consumers: DigestConsumer[],
): Map<string, number> {
  const out = new Map<string, number>();

  for (const c of consumers) {
    if (!c.deal_alerts_enabled) continue; // opt-in gate
    const mode = c.notification_mode ?? "none";
    if (mode === "none") continue;

    const favs = new Set(c.favorite_business_ids ?? []);
    const radius = isFiniteNum(c.radius_miles) && c.radius_miles > 0 ? c.radius_miles : DEFAULT_RADIUS_MILES;
    const hasLoc = isFiniteNum(c.lat) && isFiniteNum(c.lng);

    let count = 0;
    for (const d of deals) {
      const inFav = favs.has(d.business_id);

      if (mode === "favorites_only") {
        if (inFav) count++;
        continue;
      }

      // all_nearby: favorited shops always count; otherwise must be within radius.
      if (inFav) {
        count++;
        continue;
      }
      if (!hasLoc || !isFiniteNum(d.lat) || !isFiniteNum(d.lng)) continue;
      if (haversineMiles(c.lat as number, c.lng as number, d.lat, d.lng) <= radius) count++;
    }

    if (count > 0) out.set(c.user_id, count);
  }

  return out;
}
