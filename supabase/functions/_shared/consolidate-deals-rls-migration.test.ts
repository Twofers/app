import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260812130000_consolidate_deals_rls_policies.sql",
  ),
  "utf8",
);

describe("consolidate_deals_rls_policies migration (deals RLS F2/F3)", () => {
  it("adds a SECURITY DEFINER owner-check helper that reads businesses for the caller", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_business_owner\(p_business_id uuid\)/,
    );
    expect(migration).toMatch(/SECURITY DEFINER/);
    expect(migration).toMatch(/SET row_security = off/);
  });

  it("locks the helper down to authenticated (revokes PUBLIC/anon)", () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.is_business_owner\(uuid\) FROM PUBLIC, anon/,
    );
    expect(migration).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.is_business_owner\(uuid\) TO authenticated/,
    );
  });

  it("drops the drifted / duplicate / businesses-referencing policies", () => {
    for (const name of [
      "deals_public_read_live",
      "public view active deals",
      "Anyone can read active deals",
      "Businesses can read their own deals",
      "deals_owner_crud",
      "business manage own deals",
    ]) {
      expect(migration).toContain(`DROP POLICY IF EXISTS "${name}" `);
    }
  });

  it("recreates owner policies through the helper, never inlining businesses.owner_id", () => {
    expect(migration).toMatch(/CREATE POLICY "deals_owner_select"[\s\S]*is_business_owner\(business_id\)/);
    expect(migration).toMatch(/CREATE POLICY "deals_owner_insert"[\s\S]*is_business_owner\(business_id\)/);
    expect(migration).toMatch(/CREATE POLICY "deals_owner_update"[\s\S]*is_business_owner\(business_id\)/);
    expect(migration).toMatch(/CREATE POLICY "deals_owner_delete"[\s\S]*is_business_owner\(business_id\)/);
    // Decision (b) ON: owner delete is limited to already-ended deals.
    expect(migration).toMatch(
      /CREATE POLICY "deals_owner_delete"[\s\S]*is_business_owner\(business_id\)[\s\S]*AND end_time <= now\(\)/,
    );
    // No policy body may re-inline the ungranted column (that is the F3 bug).
    const active = migration.replace(/^\s*--.*$/gm, ""); // strip comment lines
    expect(active).not.toMatch(/CREATE POLICY[\s\S]*owner_id = auth\.uid\(\)/);
  });

  it("keeps one correct public-read policy with the start_time gate (fixes F1)", () => {
    expect(migration).toMatch(
      /CREATE POLICY "deals_public_read"[\s\S]*is_active = true AND start_time <= now\(\) AND end_time > now\(\)/,
    );
  });

  it("does not touch the claimant-read or RESTRICTIVE redeemer guards", () => {
    expect(migration).not.toMatch(/DROP POLICY[^\n]*Users can read deals they claimed/);
    expect(migration).not.toMatch(/DROP POLICY[^\n]*redeemer_deals_/);
  });
});
