/**
 * Business name lock predicate (pure, no imports — safe for vitest and for
 * any module that must not drag in the supabase client).
 *
 * Once a business's lifecycle status is publicly visible, its display name is
 * locked server-side: the enforce_businesses_protected_columns trigger rejects
 * direct renames and update-business-profile-section returns
 * `business_name_locked` (migration 20260816120000). Renames go through
 * `business_name_change_requests` (see lib/business-name-change.ts).
 *
 * KEEP THE STATUS LIST IN SYNC with public.is_public_business_status (SQL) and
 * supabase/functions/_shared/business-identity-lock.ts —
 * business-name-lock-source.test.ts fails if the copies drift.
 */

export const NON_PUBLIC_BUSINESS_STATUSES = [
  "draft",
  "pending_verification",
  "approved_not_activated",
  "rejected",
] as const;

/** Stable error token the server returns for a locked rename attempt. */
export const BUSINESS_NAME_LOCKED_ERROR = "business_name_locked";

/**
 * True once the business is publicly visible, i.e. the name field must render
 * read-only and renames go through a change request. Unknown/absent status
 * fails open (editable) — the server still enforces the lock either way.
 */
export function isBusinessNameLocked(status: unknown): boolean {
  if (typeof status !== "string" || status.length === 0) return false;
  return !(NON_PUBLIC_BUSINESS_STATUSES as readonly string[]).includes(status);
}
