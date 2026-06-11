import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { fetchOwnerBusiness } from "@/lib/owner-business";
import type { TabMode } from "@/lib/tab-mode";

/** auth user_metadata key set at signUp so the chosen role survives email verification. */
export const SIGNUP_ROLE_META_KEY = "signup_role";

function asRole(raw: unknown): TabMode | null {
  return raw === "business" || raw === "customer" ? raw : null;
}

/**
 * All reads/writes are best-effort: `profiles.role` may not exist yet
 * (migration 20260711120000 is written but not applied), and a stale
 * PostgREST schema cache must never block auth flows.
 */
export async function fetchStoredRoleForUser(userId: string): Promise<TabMode | null> {
  try {
    const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (error || !data) return null;
    return asRole((data as { role?: unknown }).role);
  } catch {
    return null;
  }
}

/** Spec rule for accounts without a stored role: owns a businesses row -> business, else customer. */
export async function deriveRoleFromData(userId: string): Promise<TabMode> {
  try {
    // An `owner_id` filter needs column SELECT privilege once the businesses
    // PII column-grant migration lands; fetchOwnerBusiness routes through the
    // get_my_business() RPC (with a pre-migration direct-select fallback).
    const { row, error } = await fetchOwnerBusiness(supabase, userId);
    if (!error && row) return "business";
  } catch {
    /* fall through to customer */
  }
  return "customer";
}

export async function persistRoleForUser(userId: string, role: TabMode): Promise<void> {
  try {
    const { error } = await supabase.from("profiles").upsert(
      { id: userId, role, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    if (error && __DEV__) console.warn("[profiles-role] upsert failed:", error.message);
  } catch (e) {
    if (__DEV__) console.warn("[profiles-role] upsert exception:", e);
  }
}

/**
 * Resolve the permanent role for a signed-in user:
 * 1. `profiles.role` (authoritative once the migration is applied)
 * 2. `user_metadata.signup_role` (new signups, survives email verification)
 * 3. derived from data (existing accounts: businesses owner -> business)
 * Persists the result when it wasn't already stored, so the account self-heals.
 */
export async function resolveRoleForUser(user: User): Promise<TabMode> {
  const stored = await fetchStoredRoleForUser(user.id);
  if (stored) return stored;

  const fromSignup = asRole((user.user_metadata as Record<string, unknown> | undefined)?.[SIGNUP_ROLE_META_KEY]);
  const role = fromSignup ?? (await deriveRoleFromData(user.id));
  void persistRoleForUser(user.id, role);
  return role;
}
