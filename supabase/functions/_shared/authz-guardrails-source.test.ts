import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// Audit F-001/F-002/F-003 guardrails: the forward migrations that make
// publication and public visibility database-authoritative must keep their
// load-bearing clauses, and the shared client-embedded invite secret must not
// come back.
describe("authorization guardrail migrations (audit F-001/F-002/F-003)", () => {
  it("keeps the public business predicate with the owner exception (F-002)", () => {
    const migration = read("supabase/migrations/20260814120000_public_business_predicate_and_publish_gate.sql");
    // One shared helper owns the status list...
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.is_publicly_visible_business/);
    expect(migration).toMatch(/status NOT IN \('draft', 'pending_verification', 'rejected'\)/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_publicly_visible_business\(uuid\) TO anon, authenticated/);
    // ...and the policy uses it, with the owner exception (business setup /
    // settings reads must keep seeing the owner's own pending row).
    expect(migration).toMatch(/CREATE POLICY "businesses_public_read"/);
    expect(migration).toMatch(/public\.is_publicly_visible_business\(id\)\s*\n\s*OR owner_id = \(SELECT auth\.uid\(\)\)/);
    // Prod has documented hand-created policy drift; permissive SELECT
    // policies OR together, so the migration must sweep unknown ones too.
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Anyone can read businesses"/);
    expect(migration).toMatch(/FROM pg_policies/);
    expect(migration).toMatch(/permissive = 'PERMISSIVE'/);
    expect(migration).toMatch(/EXECUTE format\('DROP POLICY %I ON public\.businesses'/);
  });

  it("gates live-state deal writes on can_business_publish AND visibility, null-safe (F-001)", () => {
    const migration = read("supabase/migrations/20260814120000_public_business_predicate_and_publish_gate.sql");
    for (const policy of ["deals_owner_insert", "deals_owner_update"]) {
      expect(migration).toMatch(new RegExp(`CREATE POLICY "${policy}"`));
    }
    // Live-capable definition and the eligibility check, COALESCEd to false so
    // a NULL from the helper can never grant access.
    expect(migration).toMatch(/NOT \(is_active = true AND end_time > now\(\)\)/);
    const eligibilityClauses = migration.match(
      /COALESCE\(\(public\.can_business_publish\(business_id\) ->> 'canPublish'\)::boolean, false\)/g,
    );
    expect(eligibilityClauses?.length).toBe(2);
    // can_business_publish alone does not exclude pending_verification when a
    // subscription exists — both write policies must also require visibility.
    const visibilityClauses = migration.match(
      /AND public\.is_publicly_visible_business\(business_id\)/g,
    );
    expect(visibilityClauses?.length).toBe(2);
    // Ownership stays required on both write policies.
    const ownerChecks = migration.match(/public\.is_business_owner\(business_id\)/g);
    expect(ownerChecks?.length).toBeGreaterThanOrEqual(3);
  });

  it("replaces the shared invite secret with the open-application gate (F-003)", () => {
    const migration = read("supabase/migrations/20260814130000_business_open_application_gate.sql");
    expect(migration).not.toMatch(/'penguin'/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.validate_business_invite/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.businesses_require_invite/);
    // Service-role onboarding paths keep working.
    expect(migration).toMatch(/= 'service_role'/);
    // The per-owner self-serve cap replaces the shared-code friction.
    expect(migration).toMatch(/business limit reached/);
    expect(migration).toMatch(/status NOT IN \('rejected', 'archived'\)/);
  });

  it("ships no client-embedded invite secret (F-003)", () => {
    expect(existsSync(join(process.cwd(), "lib", "business-invite.ts"))).toBe(false);
    for (const file of ["app/auth-landing.tsx", "app/business-setup.tsx"]) {
      const source = read(file);
      // Note: "penguin" alone would false-positive on the mascot image asset
      // (penguin-auth-512.png); match the quoted code literal instead.
      expect(source, `${file} must not reference the invite gate`).not.toMatch(/BUSINESS_INVITE|isValidBusinessInviteCode|submitBusinessInvite|business-invite|["']penguin["']/i);
    }
  });
});
