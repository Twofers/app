import { haversineMiles } from "./geo";

export type ConsumerFeedCoords = { lat: number; lng: number };

export type BusinessCoordsSource =
  | {
      latitude: number | string | null;
      longitude: number | string | null;
    }
  | null
  | undefined;

export type DealWithBusinessCoords = {
  id: string;
  business_id: string;
  businesses?: BusinessCoordsSource;
};

export function readBusinessCoordinates(business: BusinessCoordsSource): ConsumerFeedCoords | null {
  if (!business) return null;
  const lat =
    typeof business.latitude === "number"
      ? business.latitude
      : business.latitude != null
        ? Number(business.latitude)
        : NaN;
  const lng =
    typeof business.longitude === "number"
      ? business.longitude
      : business.longitude != null
        ? Number(business.longitude)
        : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function shouldShowDealInNearbyFeed(params: {
  deal: DealWithBusinessCoords;
  userGeo: ConsumerFeedCoords | null;
  radiusMiles: number;
  favoriteBusinessIds: Iterable<string>;
}): boolean {
  const { deal, userGeo, radiusMiles, favoriteBusinessIds } = params;
  if (!userGeo) return true;

  const favorites = favoriteBusinessIds instanceof Set ? favoriteBusinessIds : new Set(favoriteBusinessIds);
  if (favorites.has(deal.business_id)) return true;

  const coords = readBusinessCoordinates(deal.businesses);
  if (!coords) {
    // A published deal should not be invisible just because a pilot business is missing
    // geocoded coordinates. Rank it after located deals, but keep it discoverable.
    return true;
  }

  return haversineMiles(userGeo.lat, userGeo.lng, coords.lat, coords.lng) <= radiusMiles;
}

export function mergeDealsById<T extends { id: string }>(primary: T[], secondary: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const deal of [...primary, ...secondary]) {
    if (seen.has(deal.id)) continue;
    seen.add(deal.id);
    merged.push(deal);
  }
  return merged;
}
