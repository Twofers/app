import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260812120000_drop_deals_public_read_live.sql",
  ),
  "utf8",
);

describe("drop_deals_public_read_live migration (deals RLS finding F1)", () => {
  it("drops the over-permissive public-read policy", () => {
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS "deals_public_read_live" ON public\.deals/,
    );
  });

  it("is idempotent (IF EXISTS) so it is a no-op where the drifted policy is absent", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS/);
  });

  it("does not drop the two correct public-read policies that keep the start_time gate", () => {
    expect(migration).not.toMatch(/DROP POLICY IF EXISTS "Anyone can read active deals"/);
    expect(migration).not.toMatch(/DROP POLICY IF EXISTS "public view active deals"/);
  });

  it("only removes a policy — it must not widen any grant or create a policy", () => {
    expect(migration).not.toMatch(/CREATE POLICY/i);
    expect(migration).not.toMatch(/\bGRANT\b/i);
  });
});
