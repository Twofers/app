import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260723120000_offer_versions_foundation.sql"),
  "utf8",
);

describe("offer versions foundation migration", () => {
  it("is marked as an approval-gated draft", () => {
    expect(migration).toMatch(/Do not apply without Dan's[\s\S]+explicit migration approval/i);
  });

  it("creates service-role-only offer definition and version tables", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.offer_definitions/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.offer_versions/i);
    expect(migration).toMatch(/ALTER TABLE public\.offer_definitions ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.offer_versions ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.offer_definitions FROM anon, authenticated/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.offer_versions FROM anon, authenticated/i);
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+offer_definitions/i);
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+offer_versions/i);
  });

  it("adds nullable immutable-version pointers to deals, claims, and redemptions", () => {
    expect(migration).toMatch(/ALTER TABLE public\.deals[\s\S]+offer_version_id/i);
    expect(migration).toMatch(/ALTER TABLE public\.deal_claims[\s\S]+offer_version_id/i);
    expect(migration).toMatch(/ALTER TABLE public\.redemptions[\s\S]+offer_version_id/i);
    expect(migration).toMatch(/idx_deal_claims_offer_version/i);
    expect(migration).toMatch(/idx_redemptions_offer_version/i);
  });

  it("backfills legacy deals into version 1 snapshots", () => {
    expect(migration).toMatch(/legacy_deal_backfill/i);
    expect(migration).toMatch(/INSERT INTO public\.offer_definitions/i);
    expect(migration).toMatch(/INSERT INTO public\.offer_versions/i);
    expect(migration).toMatch(/'offerVersion', 1/i);
    expect(migration).toMatch(/UPDATE public\.deal_claims dc[\s\S]+offer_version_id = d\.offer_version_id/i);
  });
});
