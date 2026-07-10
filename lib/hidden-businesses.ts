import { supabase } from "@/lib/supabase";

/**
 * Per-user "hide this business" preference (Apple App Store guideline 1.2 block
 * control). A customer can hide any business; its deals are then filtered out of
 * their feed and map. Backed by the `hidden_businesses` table (see migration
 * 20260810120000), which is RLS-scoped so a user only ever sees/writes their own
 * rows.
 *
 * Reads here are best-effort and fail OPEN: on any error (missing table, RLS,
 * network) we return an empty set so the feed degrades to showing everything.
 * This is presentation/preference only — nothing here gates a security decision.
 * Writes report ok/!ok so callers can surface a retry.
 */

/**
 * Loads the set of business ids the given user has hidden. Returns an empty set
 * for a signed-out user or on any error.
 */
export async function loadHiddenBusinessIds(userId: string | null): Promise<Set<string>> {
  const hidden = new Set<string>();
  if (!userId) return hidden;

  const { data, error } = await supabase
    .from("hidden_businesses")
    .select("business_id")
    .eq("user_id", userId);
  if (error || !data) return hidden;

  for (const row of data as { business_id: string | null }[]) {
    if (row.business_id) hidden.add(row.business_id);
  }
  return hidden;
}

/**
 * Hides a business for the given user. Idempotent: re-hiding an already-hidden
 * business is treated as success (the primary key makes the duplicate insert a
 * conflict we intentionally ignore).
 */
export async function hideBusiness(params: {
  userId: string;
  businessId: string;
}): Promise<{ ok: boolean }> {
  const { error } = await supabase
    .from("hidden_businesses")
    .upsert(
      { user_id: params.userId, business_id: params.businessId },
      { onConflict: "user_id,business_id", ignoreDuplicates: true },
    );
  return { ok: !error };
}

/** Un-hides a business for the given user. Missing rows are a no-op success. */
export async function unhideBusiness(params: {
  userId: string;
  businessId: string;
}): Promise<{ ok: boolean }> {
  const { error } = await supabase
    .from("hidden_businesses")
    .delete()
    .eq("user_id", params.userId)
    .eq("business_id", params.businessId);
  return { ok: !error };
}

/**
 * Loads the businesses a user has hidden, with their display names, for the
 * "Hidden businesses" management list in Settings. Newest-hidden first. Returns
 * an empty array on any error.
 */
export type HiddenBusinessRow = { businessId: string; name: string };

export async function loadHiddenBusinessesWithNames(
  userId: string | null,
): Promise<HiddenBusinessRow[]> {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("hidden_businesses")
    .select("business_id, created_at, businesses(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  const rows: HiddenBusinessRow[] = [];
  for (const row of data as {
    business_id: string | null;
    businesses: { name: string | null } | { name: string | null }[] | null;
  }[]) {
    if (!row.business_id) continue;
    // PostgREST returns the embedded relation as an object for a to-one FK, but
    // some client typings model it as an array; handle both defensively.
    const rel = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses;
    rows.push({ businessId: row.business_id, name: rel?.name ?? "" });
  }
  return rows;
}
