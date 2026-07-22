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
 * That migration IS applied in production (verified 2026-07-19: the RPC returns
 * the caller's full row, and anon is correctly denied the PII columns). The
 * legacy direct-select fallback that used to live here has been removed — it
 * only ever worked because of an over-broad table-level SELECT grant on
 * `businesses` in production, and once that grant is repaired the fallback
 * would 42501 and mask the real RPC error behind a confusing second failure.
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
  current_profile_version: number | null;
  // Present on the get_my_business() RPC path (full row); absent on the
  // legacy direct-select fallback, whose column list predates the status
  // column grant. Callers treat undefined as "not locked" — the server
  // enforces the name lock regardless.
  status?: string | null;
};

export type OwnerBusinessResult = {
  row: OwnerBusinessRow | null;
  error: PostgrestError | null;
};

/**
 * The RPC is already scoped to `auth.uid()`, so no owner id argument is needed —
 * and passing one would be misleading, since a caller cannot read another
 * owner's row through this path.
 */
export async function fetchOwnerBusiness(
  client: SupabaseClient,
): Promise<OwnerBusinessResult> {
  const rpc = await client.rpc("get_my_business");
  if (rpc.error) return { row: null, error: rpc.error };
  const rows = Array.isArray(rpc.data) ? rpc.data : rpc.data ? [rpc.data] : [];
  return { row: (rows[0] as OwnerBusinessRow | undefined) ?? null, error: null };
}
