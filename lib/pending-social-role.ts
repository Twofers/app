import { secureDeleteItem, secureGetItem, secureSetItem } from "./redemption-secure-store";
import type { CachedTabModeRole as TabMode } from "./tab-mode-cache";

/**
 * The role chosen before a native Google/Apple picker took over the screen.
 *
 * `supabase.auth.signInWithIdToken` accepts no user metadata, so the role cannot ride the token the
 * way `signup_role` rides `signUp`. It is kept locally instead: a module cache for the common case
 * plus SecureStore so the choice survives Android killing the app while the picker is in front.
 *
 * Lives in its own dependency-light module because `lib/profiles-role.ts` must read it too, and that
 * module is loaded from `TabModeProvider` — it must not pull the social-auth native import graph in.
 */

export const PENDING_SOCIAL_ROLE_KEY = "twofer_pending_social_role_v1";

let pendingRoleCache: TabMode | null = null;

function asRole(raw: unknown): TabMode | null {
  return raw === "business" || raw === "customer" ? raw : null;
}

export async function setPendingSocialRole(role: TabMode): Promise<void> {
  pendingRoleCache = role;
  try {
    await secureSetItem(PENDING_SOCIAL_ROLE_KEY, role);
  } catch {
    /* cache still holds it for this process */
  }
}

/**
 * Read the pending role WITHOUT consuming it. `resolveRoleForUser` uses this because it runs
 * concurrently (TabModeProvider resolves on every session change) and must not steal the value
 * from the screen that is completing the sign-in.
 */
export async function peekPendingSocialRole(): Promise<TabMode | null> {
  if (pendingRoleCache) return pendingRoleCache;
  try {
    return asRole(await secureGetItem(PENDING_SOCIAL_ROLE_KEY));
  } catch {
    return null;
  }
}

/** Reads the pending role and clears it — a stale choice must never leak into a later sign-in. */
export async function takePendingSocialRole(): Promise<TabMode | null> {
  const role = await peekPendingSocialRole();
  await clearPendingSocialRole();
  return role;
}

export async function clearPendingSocialRole(): Promise<void> {
  pendingRoleCache = null;
  try {
    await secureDeleteItem(PENDING_SOCIAL_ROLE_KEY);
  } catch {
    /* noop */
  }
}
