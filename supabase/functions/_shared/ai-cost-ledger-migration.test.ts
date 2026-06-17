import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260722120000_ai_generation_cost_ledger.sql"),
  "utf8",
);

describe("ai_generation_costs migration", () => {
  it("locks owner and customer reads behind RLS and grants service role only", () => {
    expect(migration).toMatch(/ALTER TABLE public\.ai_generation_costs ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.ai_generation_costs FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT ON public\.ai_generation_costs TO service_role/i);
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+ai_generation_costs/i);
  });

  it("creates internal monthly reporting views", () => {
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.ai_generation_cost_daily/i);
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.ai_generation_cost_by_business/i);
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.ai_generation_cost_by_deal/i);
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.ai_generation_cost_by_feature_model/i);
  });
});
