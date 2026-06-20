import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260724120000_offer_version_publish_rpc.sql"),
  "utf8",
);

describe("offer version publish rpc migration", () => {
  it("is marked as approval gated", () => {
    expect(migration).toMatch(/Do not apply without Dan's[\s\S]+explicit migration approval/i);
  });

  it("creates service-role-only publish events with idempotency", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.publish_events/i);
    expect(migration).toMatch(/UNIQUE \(business_id, idempotency_key\)/i);
    expect(migration).toMatch(/ALTER TABLE public\.publish_events ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.publish_events FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.publish_events TO service_role/i);
  });

  it("publishes offer definition, version, deal, and event in one rpc", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.publish_offer_versioned_deal/i);
    expect(migration).toMatch(/INSERT INTO public\.offer_definitions/i);
    expect(migration).toMatch(/INSERT INTO public\.offer_versions/i);
    expect(migration).toMatch(/INSERT INTO public\.deals/i);
    expect(migration).toMatch(/offer_definition_id,\s*offer_version_id/i);
    expect(migration).toMatch(/UPDATE public\.publish_events[\s\S]+status = 'published'/i);
  });

  it("stores the approved AdSpec on the immutable offer version", () => {
    expect(migration).toMatch(/ALTER TABLE public\.offer_versions[\s\S]+ADD COLUMN IF NOT EXISTS ad_spec jsonb/i);
    expect(migration).toMatch(/offer_versions_ad_spec_object_check/i);
    expect(migration).toMatch(/COMMENT ON COLUMN public\.offer_versions\.ad_spec/i);
    expect(migration).toMatch(/offer_snapshot,\s*ad_spec/i);
    expect(migration).toMatch(/p_ad_spec/i);
  });

  it("does not expose the rpc to clients", () => {
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.publish_offer_versioned_deal\(uuid, uuid, jsonb, jsonb, text, jsonb\)[\s\S]+FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.publish_offer_versioned_deal\(uuid, uuid, jsonb, jsonb, text, jsonb\)[\s\S]+TO service_role/i);
  });
});
