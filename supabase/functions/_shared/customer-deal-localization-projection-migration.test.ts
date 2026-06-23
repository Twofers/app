import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260728123000_customer_deal_localization_projection.sql"),
  "utf8",
);

describe("customer deal localization projection migration", () => {
  it("is marked as approval gated", () => {
    expect(migration).toMatch(/Do not apply without Dan's[\s\S]+explicit migration approval/i);
  });

  it("creates a narrow security-definer customer projection", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.customer_deal_localizations/i);
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/RETURNS TABLE[\s\S]+deal_id uuid[\s\S]+headline text[\s\S]+localized_term_snapshot jsonb/i);
    expect(migration).toMatch(/JOIN public\.offer_versions ov/i);
    expect(migration).toMatch(/JOIN public\.ad_localizations al/i);
  });

  it("does not open direct table access to customer roles", () => {
    expect(migration).not.toMatch(/GRANT\s+SELECT[\s\S]+public\.offer_versions[\s\S]+TO\s+(anon|authenticated)/i);
    expect(migration).not.toMatch(/GRANT\s+SELECT[\s\S]+public\.ad_localizations[\s\S]+TO\s+(anon|authenticated)/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.customer_deal_localizations\(uuid\[\], text\)[\s\S]+FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.customer_deal_localizations\(uuid\[\], text\)[\s\S]+TO anon, authenticated/i);
  });

  it("only returns active published approved locale rows", () => {
    expect(migration).toMatch(/d\.is_active IS TRUE/i);
    expect(migration).toMatch(/d\.end_time IS NULL OR d\.end_time >= now\(\)/i);
    expect(migration).toMatch(/ov\.status = 'published'/i);
    expect(migration).toMatch(/p_locale = ANY\(ov\.enabled_locales\)/i);
    expect(migration).toMatch(/al\.translation_status IN \('source_creative', 'persuasive_transcreation', 'deterministic_fallback'\)/i);
    expect(migration).toMatch(/al\.qa_decision IN \('not_required', 'pass'\)/i);
  });
});
