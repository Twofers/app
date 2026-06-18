import { getDealDisplayTitle } from "./deal-display-copy";

export type ReuseHistoryDeal = {
  id: string;
  title?: string | null;
  price?: number | string | null;
  created_at?: string | null;
  end_time?: string | null;
  deal_type?: string | null;
  discount_percent?: number | string | null;
  item_description?: string | null;
  required_item_description?: string | null;
  free_item_description?: string | null;
};

export type ReuseHistoryRow<T extends ReuseHistoryDeal> = {
  deal: T;
  title: string;
  lastUsedAt: string | null;
  regularPrice: string | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function timeMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function priceText(value: number | string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${n.toFixed(2)}`;
}

function identityKey(deal: ReuseHistoryDeal, title: string): string {
  return [
    title,
    deal.deal_type,
    deal.discount_percent,
    deal.item_description,
    deal.required_item_description,
    deal.free_item_description,
    priceText(deal.price),
  ]
    .map((part) => clean(part).toLocaleLowerCase())
    .join("|");
}

export function buildReuseHistoryRows<T extends ReuseHistoryDeal>(
  deals: T[],
  options?: { untitled?: string },
): ReuseHistoryRow<T>[] {
  const untitled = options?.untitled ?? "Untitled";
  const sorted = [...deals].sort((a, b) => {
    const bTime = timeMs(b.created_at) || timeMs(b.end_time);
    const aTime = timeMs(a.created_at) || timeMs(a.end_time);
    return bTime - aTime;
  });
  const seen = new Set<string>();
  const rows: ReuseHistoryRow<T>[] = [];

  for (const deal of sorted) {
    const title = getDealDisplayTitle(deal, deal.title) || untitled;
    const key = identityKey(deal, title);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      deal,
      title,
      lastUsedAt: clean(deal.created_at) || clean(deal.end_time) || null,
      regularPrice: priceText(deal.price),
    });
  }

  return rows;
}
