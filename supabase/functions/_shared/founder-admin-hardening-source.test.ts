import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8");

describe("founder-only admin hardening", () => {
  it("pins the shared guard to configured founder owner access and mandatory aal2", () => {
    const source = read("supabase/functions/_shared/admin-prospects.ts");
    expect(source).toMatch(/founderAdminUserId\(\)/);
    expect(source).toMatch(/isFounderAdminUser\(user\.id, adminUser\.role\)/);
    expect(source).toMatch(/adminUser\.require_mfa !== true/);
    expect(source).toMatch(/if \(!isAal2\(bearerToken\)\)/);
  });

  it("routes both formerly-inline guards through the shared guard", () => {
    for (const file of [
      "supabase/functions/admin-account-management/index.ts",
      "supabase/functions/admin-ai-usage/index.ts",
      "supabase/functions/admin-business-applications/index.ts",
      "supabase/functions/admin-dashboard-summary/index.ts",
    ]) {
      const source = read(file);
      expect(source).toMatch(/requireAdmin\(req, requestId, "prospect\.read"\)/);
      expect(source).not.toMatch(/createClient\(/);
      expect(source).not.toMatch(/auth\.getUser\(bearerToken\)/);
    }
  });

  it("removes dashboard permanent deletion and requires fresh TOTP for sensitive actions", () => {
    const source = read("supabase/functions/admin-account-management/index.ts");
    const page = read("website/admin/accounts/index.html");
    const script = read("website/admin/accounts.js");
    expect(source).not.toContain("permanent_delete");
    expect(source).toMatch(/isFreshTotp\(bearerToken\)/);
    expect(source).toContain("fresh_totp_required");
    expect(page).not.toContain("Permanently delete");
    expect(script).not.toContain("permanent_delete");
  });

  it("signs the founder in with email + TOTP only, never a submitted password", () => {
    const authSession = read("supabase/functions/admin-auth-session/index.ts");
    const page = read("website/admin/login/index.html");
    const script = read("website/admin/admin-login.js");
    const api = read("website/api/admin/session.js");

    // No password anywhere: not a form field, not a stored secret, not a grant.
    expect(authSession).not.toMatch(/payload\.password/);
    expect(authSession).not.toMatch(/FOUNDER_ADMIN_PASSWORD/);
    expect(authSession).not.toMatch(/grant_type=password/);
    expect(authSession).toMatch(/auth\/v1\/admin\/generate_link/);
    expect(page).not.toMatch(/type="password"/);
    expect(script).not.toMatch(/password/);
    expect(api).not.toMatch(/req\.body\?\.password/);

    // A code is required up front, and only an aal2 session is handed back.
    expect(authSession).toMatch(/!isRefresh && \(!email \|\| !code\)/);
    expect(authSession).toMatch(/decodeJwtAal\(verified\.access_token\) !== "aal2"/);
    expect(authSession).toMatch(/reason: "invalid_totp_code"/);
    expect(authSession).toMatch(/revokeSession\(/);
  });

  it("makes MFA mandatory for current and future admin rows", () => {
    const migration = read("supabase/migrations/20260824123000_mandatory_admin_mfa.sql");
    const authSession = read("supabase/functions/admin-auth-session/index.ts");
    expect(migration).toMatch(/UPDATE public\.admin_users[\s\S]*require_mfa = true/i);
    expect(migration).toMatch(/ALTER COLUMN require_mfa SET DEFAULT true/i);
    expect(migration).toMatch(/ALTER COLUMN require_mfa SET NOT NULL/i);
    expect(authSession).toMatch(/data\.require_mfa !== true/);
  });
});
