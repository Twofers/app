import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/**
 * Owner-side read of the caller's own `businesses` row.
 *
 * Migration 20260705120000 revokes table-level SELECT on `businesses` and grants
 * only a non-PII column list to `authenticated` — so an owner can no longer
 * `select contact_name,business_email,tone` or even filter `.eq("owner_id", …)`
 * (column privileges apply to WHERE clauses too). The same migration provides
 * `get_my_business()`, a SECURITY DEFINER function that returns the caller's
 * full row.
 *
 * That migration is NOT applied in production yet, so the RPC may not exist.
 * This helper tries the RPC first and falls back to the legacy direct select
 * when the RPC errors (e.g. function not found pre-migration). Once Dan applies
 * the migration the RPC succeeds and the fallback never runs.
 */

export type OwnerBusinessRow = {
  id: string;
  name: string;
  contact_name: string | null;
  business_email: string | null;
  address: string | null;
  category: string | null;
  tone: string | null;
  location: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  short_description: string | null;
  preferred_locale: string | null;
  phone: string | null;
  hours_text: string | null;
  logo_url: string | null;
};

const OWNER_BUSINESS_COLUMNS =
  "id,name,contact_name,business_email,address,category,tone,location,latitude,longitude,short_description,preferred_locale,phone,hours_text,logo_url";

export type OwnerBusinessResult = {
  row: OwnerBusinessRow | null;
  error: PostgrestError | null;
};

export async function fetchOwnerBusiness(
  client: SupabaseClient,
  ownerUserId: string,
): Promise<OwnerBusinessResult> {
  const rpc = await client.rpc("get_my_business");
  if (!rpc.error) {
    const rows = Array.isArray(rpc.data) ? rpc.data : rpc.data ? [rpc.data] : [];
    return { row: (rows[0] as OwnerBusinessRow | undefined) ?? null, error: null };
  }

  // Pre-migration fallback: direct select still works while the table grant is
  // unrestricted. Post-migration this would fail too, and we surface its error.
  const direct = await client
    .from("businesses")
    .select(OWNER_BUSINESS_COLUMNS)
    .eq("owner_id", ownerUserId)
    .maybeSingle();
  if (direct.error) return { row: null, error: direct.error };
  return { row: (direct.data as OwnerBusinessRow | null) ?? null, error: null };
}
