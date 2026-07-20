import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260819130000_promo_materials_authorizations.sql"),
  "utf8",
);

// Absence assertions run against executable SQL only: a `-- ...` comment that
// merely names can_business_publish or DELETE must not fail the check.
const sql = migration.replace(/--[^\n]*/g, "");

describe("promo_materials_authorizations migration", () => {
  // Required case 4: the consent record captures who authorized, under which
  // terms version, and through which surface.
  it("creates the consent table with the full audit shape", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.promo_materials_authorizations/);
    expect(migration).toMatch(/business_id uuid NOT NULL REFERENCES public\.businesses\(id\) ON DELETE CASCADE/);
    expect(migration).toMatch(/location_id uuid NOT NULL REFERENCES public\.business_locations\(id\) ON DELETE CASCADE/);
    expect(migration).toMatch(/authorized_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(migration).toMatch(/revoked_at timestamptz/);
    expect(migration).toMatch(/revoked_by_user_id uuid REFERENCES auth\.users\(id\)/);
    expect(migration).toMatch(/authorizer_name text/);
    expect(migration).toMatch(/authorizer_role text/);
    expect(migration).toMatch(/business_terms_version text NOT NULL/);
    expect(migration).toMatch(/permission_received_at timestamptz/);
    expect(migration).toMatch(/recorded_by_admin_user_id uuid REFERENCES public\.admin_users\(id\)/);
  });

  it("restricts source to the four known surfaces", () => {
    expect(migration).toMatch(
      /CHECK \(source IN \('app_onboarding', 'app_settings', 'website_onboarding', 'admin_assisted'\)\)/,
    );
  });

  // Required case 10: an admin can never record a bare authorization.
  it("forces authorizer identity, permission date, and recording admin on the admin-assisted path", () => {
    expect(migration).toMatch(/promo_materials_authorizations_admin_identity_check/);
    expect(migration).toMatch(/source <> 'admin_assisted'/);
    expect(migration).toMatch(/authorizer_name IS NOT NULL/);
    expect(migration).toMatch(/authorizer_role IS NOT NULL/);
    expect(migration).toMatch(/permission_received_at IS NOT NULL/);
    expect(migration).toMatch(/recorded_by_admin_user_id IS NOT NULL/);
  });

  it("allows at most one active authorization per location", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS promo_auth_one_active_per_location[\s\S]*?WHERE revoked_at IS NULL/,
    );
  });

  // Required case 7: revoking must never destroy history, so nobody gets DELETE.
  it("grants no DELETE to any role and keeps writes service-role only", () => {
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.promo_materials_authorizations FROM anon, authenticated/);
    expect(migration).toMatch(/GRANT SELECT ON TABLE public\.promo_materials_authorizations TO authenticated/);
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON TABLE public\.promo_materials_authorizations TO service_role/,
    );
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*promo_materials_authorizations/i);
    // No authenticated INSERT/UPDATE policy: all writes go through edge functions.
    expect(sql).not.toMatch(/CREATE POLICY[^;]*promo_materials_authorizations FOR (INSERT|UPDATE)/i);
  });

  it("enables RLS with a member-scoped read and a NULL-safe redeemer block", () => {
    expect(migration).toMatch(/ALTER TABLE public\.promo_materials_authorizations ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/promo_materials_authorizations_member_read/);
    expect(migration).toMatch(/COALESCE\(public\.is_business_member\(business_id\), false\)/);
    expect(migration).toMatch(/redeemer_promo_materials_authorizations_block_all/);
    expect(migration).toMatch(/AS RESTRICTIVE FOR ALL TO authenticated/);
    // Prior incident: a NULL inside a RESTRICTIVE policy denies every caller.
    expect(migration).toMatch(/NOT COALESCE\(public\.is_redeemer_session\(\), false\)/);
  });

  // Required case 8: existing businesses must default to "Not authorized".
  it("adds the optional website-intake flag and performs no backfill", () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.business_applications[\s\S]*?ADD COLUMN IF NOT EXISTS promo_materials_authorized boolean NOT NULL DEFAULT false/,
    );
    expect(sql).not.toMatch(/INSERT INTO public\.promo_materials_authorizations/i);
  });

  // Required case 9: the feature is inert with respect to every gate.
  it("never touches the publish gate, capabilities, billing, or verification", () => {
    expect(sql).not.toMatch(/can_business_publish/);
    expect(sql).not.toMatch(/get_business_capabilities/);
    expect(sql).not.toMatch(/location_entitlements|subscription|stripe/i);
  });
});
