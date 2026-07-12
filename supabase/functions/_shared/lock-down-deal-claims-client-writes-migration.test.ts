import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260804121000_lock_down_deal_claims_client_writes.sql",
  ),
  "utf8",
);

describe("lock_down_deal_claims_client_writes migration (Finding 02)", () => {
  it("revokes client write access on deal_claims", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON public\.deal_claims FROM anon, authenticated/,
    );
  });

  it("drops the end-user and business-owner UPDATE policies", () => {
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS "Users can update their own claims" ON public\.deal_claims/,
    );
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS "Businesses can update claims for their deals" ON public\.deal_claims/,
    );
  });

  it("does not touch the SELECT policies", () => {
    expect(migration).not.toMatch(/DROP POLICY IF EXISTS "Users can read their own claims"/);
    expect(migration).not.toMatch(
      /DROP POLICY IF EXISTS "Businesses can read claims for their deals"/,
    );
  });
});
