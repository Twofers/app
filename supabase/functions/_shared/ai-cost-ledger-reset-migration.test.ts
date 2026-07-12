import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260806120000_ai_cost_ledger_reset_marker.sql"),
  "utf8",
);

describe("ai cost ledger reset marker migration", () => {
  it("locks the reset marker table behind RLS and grants service role only", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ai_generation_cost_ledger_resets/i);
    expect(migration).toMatch(/ALTER TABLE public\.ai_generation_cost_ledger_resets ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.ai_generation_cost_ledger_resets FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT ON public\.ai_generation_cost_ledger_resets TO service_role/i);
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+ai_generation_cost_ledger_resets/i);
  });

  it("redefines the by-feature view to count only spend since the latest reset", () => {
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.ai_generation_cost_by_feature_model/i);
    expect(migration).toMatch(/SELECT max\(reset_at\) FROM public\.ai_generation_cost_ledger_resets/i);
  });
});
