import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { fetchOwnerBusiness } from "@/lib/owner-business";
import { peekPendingSocialRole } from "@/lib/pending-social-role";
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
    // An `owner_id` filter needs column SELECT privilege on that column, which
    // authenticated does not have (20260705120000); fetchOwnerBusiness routes
    // through the get_my_business() SECURITY DEFINER RPC instead.
    const { row, error } = await fetchOwnerBusiness(supabase);
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
/**
 * Same lookup order as `resolveRoleForUser`, but reports `null` instead of defaulting to customer
 * when nothing identifies the account yet. Native social sign-in needs that distinction: a token
 * exchange carries no metadata, so a brand-new Google/Apple user has to be asked for a role rather
 * than silently filed as a shopper. Still self-heals `profiles.role` when a role IS identified.
 */
export async function resolveKnownRoleForUser(user: User): Promise<TabMode | null> {
  const stored = await fetchStoredRoleForUser(user.id);
  if (stored) return stored;

  const fromSignup = asRole((user.user_metadata as Record<string, unknown> | undefined)?.[SIGNUP_ROLE_META_KEY]);
  if (fromSignup) {
    void persistRoleForUser(user.id, fromSignup);
    return fromSignup;
  }

  try {
    const { row, error } = await fetchOwnerBusiness(supabase);
    if (!error && row) {
      void persistRoleForUser(user.id, "business");
      return "business";
    }
  } catch {
    /* no owner business readable -> role still unknown */
  }
  return null;
}

export async function resolveRoleForUser(user: User): Promise<TabMode> {
  const stored = await fetchStoredRoleForUser(user.id);
  if (stored) return stored;

  const fromSignup = asRole((user.user_metadata as Record<string, unknown> | undefined)?.[SIGNUP_ROLE_META_KEY]);
  if (fromSignup) {
    void persistRoleForUser(user.id, fromSignup);
    return fromSignup;
  }

  // Native social sign-in cannot put the role in user_metadata, so auth-landing stashes the choice
  // locally instead. Read it (without consuming it) here too: this function also runs from
  // TabModeProvider the instant signInWithIdToken creates a session, concurrently with the screen
  // that is completing the sign-in. `profiles.role` is immutable once set, so without this the two
  // writers could disagree and a merchant who picked Business could be locked as a shopper.
  const pendingSocial = await peekPendingSocialRole();
  if (pendingSocial) {
    void persistRoleForUser(user.id, pendingSocial);
    return pendingSocial;
  }

  const derived = await deriveRoleFromData(user.id);
  // Only "business" is an affirmative signal (the account owns a businesses row). "customer" is the
  // fallback guess, and writing a guess into an immutable column is what made the race dangerous —
  // it would permanently pre-empt the role the user is about to pick on the finish-setup step.
  if (derived === "business") void persistRoleForUser(user.id, derived);
  return derived;
}
