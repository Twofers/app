import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260724121000_offer_version_claim_redemption_binding.sql"),
  "utf8",
);

describe("offer version claim/redemption binding migration", () => {
  it("is approval gated", () => {
    expect(migration).toMatch(/Do not apply without Dan's[\s\S]+explicit migration approval/i);
  });

  it("binds new claims to the deal offer version", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.set_claim_offer_version_ids/i);
    expect(migration).toMatch(/CREATE TRIGGER trg_set_claim_offer_version_ids/i);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE[\s\S]+ON public\.deal_claims/i);
  });

  it("binds redemptions from claim or deal version ids", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.set_redemption_offer_version_ids/i);
    expect(migration).toMatch(/CREATE TRIGGER trg_set_redemption_offer_version_ids/i);
    expect(migration).toMatch(/ON public\.redemptions/i);
    expect(migration).toMatch(/COALESCE\(dc\.offer_version_id, d\.offer_version_id\)/i);
  });

  it("backfills legacy claim and redemption rows", () => {
    expect(migration).toMatch(/UPDATE public\.deal_claims dc[\s\S]+offer_version_id/i);
    expect(migration).toMatch(/UPDATE public\.redemptions r[\s\S]+offer_version_id/i);
  });
});
