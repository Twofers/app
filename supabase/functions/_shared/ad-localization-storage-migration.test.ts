import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260728120000_ad_localization_storage.sql"),
  "utf8",
);

describe("ad localization storage migration", () => {
  it("is marked as approval gated", () => {
    expect(migration).toMatch(/Do not apply without Dan's[\s\S]+explicit migration approval/i);
  });

  it("adds localization metadata columns to immutable offer versions", () => {
    expect(migration).toMatch(/ALTER TABLE public\.offer_versions[\s\S]+ADD COLUMN IF NOT EXISTS source_locale text/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS enabled_locales text\[\]/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS localization_bundle_hash text/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS localized_term_snapshot jsonb/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS locale_presentation_overrides jsonb/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS translation_qa_summary jsonb/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS deterministic_fallback_locales text\[\]/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS locale_renderer_version text/i);
    expect(migration).toMatch(/offer_versions_localization_bundle_hash_check/i);
  });

  it("creates service-role-only ad localization rows keyed by offer version and locale", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ad_localizations/i);
    expect(migration).toMatch(/ad_version_id uuid NOT NULL REFERENCES public\.offer_versions\(id\) ON DELETE CASCADE/i);
    expect(migration).toMatch(/UNIQUE \(ad_version_id, locale\)/i);
    expect(migration).toMatch(/ALTER TABLE public\.ad_localizations ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.ad_localizations FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.ad_localizations TO service_role/i);
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+ad_localizations/i);
  });

  it("stores persuasive fields and hashes without exact offer mechanics", () => {
    expect(migration).toMatch(/headline text NOT NULL/i);
    expect(migration).toMatch(/supporting_copy text/i);
    expect(migration).toMatch(/image_alt_text text NOT NULL/i);
    expect(migration).toMatch(/source_copy_hash text NOT NULL/i);
    expect(migration).toMatch(/localization_hash text NOT NULL/i);
    expect(migration).toMatch(/source_copy_hash ~ '\^adsrc_\[0-9a-f\]\{8\}\$'/i);
    expect(migration).toMatch(/localization_hash ~ '\^adlocrow_\[0-9a-f\]\{8\}\$'/i);
    expect(migration).not.toMatch(/\bexact_offer_line\b/i);
    expect(migration).not.toMatch(/\bterms_line\b/i);
  });

  it("syncs approved ad_spec localization snapshots into rows", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_offer_version_localization_metadata/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.sync_ad_localizations_from_offer_version/i);
    expect(migration).toMatch(/NEW\.ad_spec->'localization'/);
    expect(migration).toMatch(/jsonb_each\(v_localization->'localizations'\)/);
    expect(migration).toMatch(/CREATE TRIGGER offer_versions_apply_localization_metadata/i);
    expect(migration).toMatch(/CREATE TRIGGER offer_versions_sync_ad_localizations/i);
  });
});
