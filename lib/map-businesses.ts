type BizRow = {
  id: string;
  name: string;
  location?: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

export type MappableBusiness = {
  id: string;
  name: string;
  location: string | null;
  lat: number;
  lng: number;
};

export type LiveDealRow = {
  business_id: string;
  live: boolean;
};

export type DealPreviewRow = {
  id: string;
  business_id: string;
  end_time: string;
};

function toFinite(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (value == null) {
    return Number.NaN;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  const lat = toFinite(latitude);
  const lng = toFinite(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export async function collectMappableBusinesses(
  fetchPage: (offset: number, limit: number) => Promise<BizRow[]>,
  pageSize = 400,
): Promise<MappableBusiness[]> {
  const out: MappableBusiness[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (true) {
    const rows = await fetchPage(offset, pageSize);
    if (!rows.length) break;

    for (const row of rows) {
      if (!row?.id || seen.has(row.id)) continue;
      if (!isValidCoordinate(row.latitude, row.longitude)) continue;
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      out.push({
        id: row.id,
        name: row.name ?? "",
        location: row.location ?? null,
        lat,
        lng,
      });
      seen.add(row.id);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return out;
}

export function deriveLiveBusinessIds(rows: LiveDealRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.live && row.business_id) out.add(row.business_id);
  }
  return out;
}

export function pickPreviewDeal<T extends DealPreviewRow>(
  deals: T[],
  businessId: string,
  isLive: (deal: T) => boolean,
): T | null {
  const businessDeals = deals.filter((deal) => deal.business_id === businessId);
  if (businessDeals.length === 0) return null;
  const liveDeal = businessDeals.find((deal) => isLive(deal));
  if (liveDeal) return liveDeal;
  const sortedByEnd = [...businessDeals].sort((a, b) => +new Date(a.end_time) - +new Date(b.end_time));
  return sortedByEnd[0] ?? null;
}

export function resolveMapTapHref({
  businessId,
  liveDealId,
}: {
  businessId: string;
  liveDealId: string | null;
}): `/deal/${string}` | `/business/${string}` {
  return liveDealId ? `/deal/${liveDealId}` : `/business/${businessId}`;
}

export function resolveMarkerTapOutcome({
  tappedBusinessId,
  selectedBusinessId,
  liveDealId,
}: {
  tappedBusinessId: string;
  selectedBusinessId: string | null;
  liveDealId: string | null;
}): { nextSelectedBusinessId: string; href: `/deal/${string}` | `/business/${string}` | null } {
  if (selectedBusinessId !== tappedBusinessId) {
    return { nextSelectedBusinessId: tappedBusinessId, href: null };
  }
  return {
    nextSelectedBusinessId: tappedBusinessId,
    href: resolveMapTapHref({ businessId: tappedBusinessId, liveDealId }),
  };
}
