import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260725120000_ad_generation_media_library.sql"),
  "utf8",
);

describe("ad generation media library migration", () => {
  it("is marked as an approval-gated draft", () => {
    expect(migration).toMatch(/Do not apply without Dan's[\s\S]+explicit migration approval/i);
  });

  it("creates brand, social, media, job, creative, and feedback persistence", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_brand_profiles/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_social_connections/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_media_assets/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ad_generation_jobs/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ad_creatives/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ad_creative_feedback/i);
  });

  it("requires owner approval, rights, moderation, and revocation checks before auto-use", () => {
    expect(migration).toMatch(/business_media_assets_auto_use_gate_check/i);
    expect(migration).toMatch(/owner_approved = true/i);
    expect(migration).toMatch(/rights_confirmed = true/i);
    expect(migration).toMatch(/approval_status = 'approved'/i);
    expect(migration).toMatch(/moderation_status = 'approved'/i);
    expect(migration).toMatch(/source_revoked_at IS NULL/i);
  });

  it("requires licensed commercial-ad stock metadata", () => {
    expect(migration).toMatch(/business_media_assets_stock_license_check/i);
    expect(migration).toMatch(/source_type <> 'twofer_stock'/i);
    expect(migration).toMatch(/commercial_ad_use_allowed = true/i);
    expect(migration).toMatch(/license_provider IS NOT NULL/i);
    expect(migration).toMatch(/license_asset_id IS NOT NULL/i);
    expect(migration).toMatch(/license_version IS NOT NULL/i);
  });

  it("keeps raw social tokens out of owner-readable rows", () => {
    expect(migration).toMatch(/token_reference text/i);
    expect(migration).toMatch(/Raw social access tokens must never be stored in this table/i);
    expect(migration).toMatch(/GRANT SELECT \([\s\S]+external_account_id[\s\S]+updated_at[\s\S]+\) ON public\.business_social_connections TO authenticated/i);
    expect(migration).not.toMatch(/GRANT SELECT ON public\.business_social_connections TO authenticated/i);
    expect(migration).not.toMatch(/access_token/i);
    expect(migration).not.toMatch(/refresh_token/i);
  });

  it("enables RLS and avoids anonymous access", () => {
    for (const table of [
      "business_brand_profiles",
      "business_social_connections",
      "business_media_assets",
      "ad_generation_jobs",
      "ad_creatives",
      "ad_creative_feedback",
    ]) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON public\\.${table} FROM anon, authenticated`, "i"));
    }
    expect(migration).not.toMatch(/GRANT [^;]+ TO anon/i);
  });

  it("uses owner-scoped policies and service-role writes for server-controlled records", () => {
    expect(migration).toMatch(/Owners can read approved media and stock/i);
    expect(migration).toMatch(/Owners can insert owner uploaded media/i);
    expect(migration).toMatch(/Owners can read their ad generation jobs/i);
    expect(migration).toMatch(/Owners can read their ad creatives/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.ad_generation_jobs TO service_role/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.ad_creatives TO service_role/i);
  });

  it("tracks the strict generated-fallback reason on jobs", () => {
    expect(migration).toMatch(/eligible_media_count integer NOT NULL DEFAULT 0/i);
    expect(migration).toMatch(/generated_fallback_reason text/i);
    expect(migration).toMatch(/generated_fallback_reason IS NULL OR generated_fallback_reason = 'NO_ELIGIBLE_MEDIA'/i);
    expect(migration).toMatch(/'creating_visual'/i);
  });
});
