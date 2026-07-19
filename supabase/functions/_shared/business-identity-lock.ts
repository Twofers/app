// Business identity lock — server-side twin of the SQL predicate
// public.is_public_business_status (migration 20260816120000).
//
// Once a business's lifecycle status is publicly visible, its display name is
// locked for the owner: the DB trigger enforce_businesses_protected_columns
// rejects direct PostgREST renames, and update-business-profile-section (which
// writes as service_role and therefore bypasses that trigger) must enforce the
// same rule with this helper. Renames instead go through
// business_name_change_requests and are applied by admins after review.
//
// KEEP THE STATUS LIST IN SYNC with the SQL helper and the client twin in
// lib/business-name-change.ts — business-name-lock-source.test.ts fails if
// the three copies drift.

export const NON_PUBLIC_BUSINESS_STATUSES = [
  "draft",
  "pending_verification",
  "approved_not_activated",
  "rejected",
] as const;

/** Stable error token returned to clients when a locked rename is attempted. */
export const BUSINESS_NAME_LOCKED_ERROR = "business_name_locked";

/** True when the status makes the business publicly visible (name locked). */
export function isPublicBusinessStatus(status: unknown): boolean {
  if (typeof status !== "string" || status.length === 0) return false;
  return !(NON_PUBLIC_BUSINESS_STATUSES as readonly string[]).includes(status);
}
