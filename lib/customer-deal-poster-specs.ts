import { parsePosterSpecV1 } from "./poster/posterAdSpec";
import type { PosterSpecV1 } from "./poster/posterTypes";
import { logPostgrestError } from "./supabase-client-log";
import { supabase } from "./supabase";

export type CustomerDealPosterSpec = {
  dealId: string;
  offerVersionId?: string | null;
  posterSpec: PosterSpecV1;
};

type CustomerDealPosterSpecRpcRow = {
  deal_id?: string | null;
  offer_version_id?: string | null;
  poster_spec?: unknown;
};

function normalizeRow(row: CustomerDealPosterSpecRpcRow): CustomerDealPosterSpec | null {
  if (!row.deal_id) return null;
  const posterSpec = parsePosterSpecV1(row.poster_spec);
  if (!posterSpec) return null;
  return {
    dealId: row.deal_id,
    offerVersionId: row.offer_version_id ?? null,
    posterSpec,
  };
}

export async function fetchCustomerDealPosterSpecs(
  dealIds: string[],
): Promise<Map<string, CustomerDealPosterSpec>> {
  const uniqueIds = Array.from(new Set(dealIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())));
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await supabase.rpc("customer_deal_poster_specs", {
    p_deal_ids: uniqueIds,
  });
  if (error || !Array.isArray(data)) {
    if (error) logPostgrestError("customer deal poster specs", error);
    return new Map();
  }

  const byDealId = new Map<string, CustomerDealPosterSpec>();
  for (const row of data as CustomerDealPosterSpecRpcRow[]) {
    const normalized = normalizeRow(row);
    if (normalized) byDealId.set(normalized.dealId, normalized);
  }
  return byDealId;
}
