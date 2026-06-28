import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260730121000_customer_deal_poster_spec_projection.sql"),
  "utf8",
);

describe("customer deal poster spec projection migration", () => {
  it("is marked as approval gated", () => {
    expect(migration).toMatch(/Do not apply without Dan's[\s\S]+explicit migration approval/i);
  });

  it("creates a narrow security-definer poster projection", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.customer_deal_poster_specs/i);
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/RETURNS TABLE[\s\S]+deal_id uuid[\s\S]+poster_spec jsonb/i);
    expect(migration).toMatch(/JOIN public\.offer_versions ov/i);
  });

  it("does not open direct offer version table access to customer roles", () => {
    expect(migration).not.toMatch(/GRANT\s+SELECT[\s\S]+public\.offer_versions[\s\S]+TO\s+(anon|authenticated)/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.customer_deal_poster_specs\(uuid\[\]\)[\s\S]+FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.customer_deal_poster_specs\(uuid\[\]\)[\s\S]+TO anon, authenticated/i);
  });

  it("returns only active published policy-safe poster specs", () => {
    expect(migration).toMatch(/d\.is_active IS TRUE/i);
    expect(migration).toMatch(/ov\.status = 'published'/i);
    expect(migration).toMatch(/creative_format' = 'poster_v1'/i);
    expect(migration).toMatch(/aspect_ratio' = '4:5'/i);
    expect(migration).toMatch(/no_app_brand_token' = 'true'/i);
    expect(migration).toMatch(/no_cta' = 'true'/i);
    expect(migration).toMatch(/no_scarcity' = 'true'/i);
    expect(migration).toMatch(/text_align' = 'center'/i);
  });
});
