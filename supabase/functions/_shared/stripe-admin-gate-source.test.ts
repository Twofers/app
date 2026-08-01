import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// Web-attack review 2026-07-31, finding H-2: the stripe-* billing functions gated
// their ADMIN surface on nothing more than an active admin_users role, skipping
// the founder-UUID lock and mandatory MFA (AAL2) that requireAdmin enforces
// everywhere else. These assertions pin the shared gate and its adoption.
describe("stripe admin billing gate (H-2)", () => {
  it("the shared gate requires BOTH the founder lock and AAL2", () => {
    const gate = read("supabase/functions/_shared/stripe-admin-gate.ts");
    expect(gate).toMatch(/import \{ isFounderAdminUser \} from "\.\/admin-founder\.ts"/);
    expect(gate).toMatch(/import \{ isAal2 \} from "\.\/admin-mfa\.ts"/);
    // Both must be required (fail-closed): a false from either denies access.
    expect(gate).toMatch(/if \(!isFounderAdminUser\([^)]*\)\) return false/);
    expect(gate).toMatch(/if \(!isAal2\([^)]*\)\) return false/);
  });

  const stripeFns = [
    "stripe-customer-portal-session",
    "stripe-create-checkout-session",
    "stripe-ensure-customer",
    "stripe-backfill-customers",
  ];

  for (const fn of stripeFns) {
    const source = read(`supabase/functions/${fn}/index.ts`);

    it(`${fn} routes its admin decision through the shared gate`, () => {
      expect(source).toMatch(/adminBillingAccessGranted/);
      expect(source).toMatch(/from "\.\.\/_shared\/stripe-admin-gate\.ts"/);
    });

    it(`${fn} no longer grants admin access on role alone`, () => {
      // The old weak gates keyed the admin decision on a raw role list. None of
      // these local role-list predicates may remain as the admin authorization.
      expect(source).not.toMatch(/function adminCan\w+\s*\(/);
      expect(source).not.toMatch(/role === "finance"/);
    });
  }
});
