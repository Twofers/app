// Web-attack review 2026-07-31, finding H-2.
//
// The stripe-* billing functions run with verify_jwt=false and historically
// gated their ADMIN surface on nothing more than an active admin_users role.
// That skipped the founder-UUID lock and the mandatory MFA (AAL2) step-up that
// `requireAdmin` (_shared/admin-prospects.ts) enforces on every other admin
// function. This helper re-imposes the same bar on the admin billing path while
// leaving the merchant/owner and emailed-token paths untouched.

import { isFounderAdminUser } from "./admin-founder.ts";
import { isAal2 } from "./admin-mfa.ts";

/** Extract the raw access token from an `Authorization: Bearer <jwt>` header. */
export function bearerTokenFromRequest(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

/**
 * True only when the caller may act on the admin billing surface: the founder
 * admin identity (founder UUID + `owner` role) presenting an AAL2 (MFA-verified)
 * session. Mirrors the requireAdmin founder-lock + MFA requirement. `role` is the
 * caller's admin_users.role (or null when they are not an active admin).
 */
export function adminBillingAccessGranted(params: {
  userId: string;
  role: string | null;
  accessToken: string;
}): boolean {
  if (!isFounderAdminUser(params.userId, params.role)) return false;
  if (!isAal2(params.accessToken)) return false;
  return true;
}
