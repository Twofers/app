import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260825140000_offer_version_revise_rpc.sql"),
  "utf8",
);

const functionSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "publish-offer-version", "index.ts"),
  "utf8",
);

describe("offer version revise rpc migration", () => {
  it("is marked as approval gated", () => {
    expect(migration).toMatch(/Do not apply[\s\S]{0,12}without Dan's[\s\S]{0,12}explicit migration approval/i);
  });

  it("appends a new published version and repoints the live deal at it", () => {
    // The whole point of the RPC: a merchant's regenerated creative only reaches
    // customers when deals.offer_version_id moves to a version carrying the new
    // ad_spec. Appending without repointing, or repointing without appending,
    // both leave the old poster live.
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.revise_offer_versioned_deal/i);
    expect(migration).toMatch(/INSERT INTO public\.offer_versions/i);
    expect(migration).toMatch(/COALESCE\(MAX\(ov\.version_number\), 0\) \+ 1/i);
    expect(migration).toMatch(/status = 'published'|'published',/i);
    expect(migration).toMatch(/UPDATE public\.deals d[\s\S]+offer_version_id = v_offer_version_id/i);
  });

  it("locks the deal row before versioning it", () => {
    expect(migration).toMatch(/FROM public\.deals d[\s\S]+FOR UPDATE/i);
    expect(migration).toMatch(/Deal not found for business/i);
  });

  it("keeps the new version off the legacy source_deal_id bridge", () => {
    // offer_versions_source_deal_unique allows exactly one version per deal to
    // claim source_deal_id; a second one would fail the unique index.
    expect(migration).toMatch(/source_deal_id,[\s\S]+NULL,/i);
  });

  it("carries the live creative forward when a revision sends no new ad spec", () => {
    // A schedule-only revision must not blank the poster: customer_deal_poster_specs
    // only projects a poster_v1 ad_spec found on the deal's CURRENT version.
    expect(migration).toMatch(/v_ad_spec := p_ad_spec/);
    expect(migration).toMatch(/IF v_ad_spec IS NULL AND v_deal\.offer_version_id IS NOT NULL THEN/);
  });

  it("writes only the deal columns the caller actually sent", () => {
    expect(migration).toMatch(/CASE WHEN v_row \? 'poster_url' THEN/);
    expect(migration).toMatch(/CASE WHEN v_row \? 'poster_storage_path' THEN/);
    expect(migration).toMatch(/CASE WHEN v_row \? 'start_time' THEN/);
  });

  it("reuses the publish idempotency ledger", () => {
    expect(migration).toMatch(/INSERT INTO public\.publish_events/i);
    expect(migration).toMatch(/offer_version_revise_v1/);
    expect(migration).toMatch(/ON CONFLICT \(business_id, idempotency_key\) DO NOTHING/i);
    expect(migration).toMatch(/idempotency_replayed := true/);
    expect(migration).toMatch(/UPDATE public\.publish_events[\s\S]+status = 'published'/i);
  });

  it("does not expose the rpc to clients", () => {
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/SET search_path = public, pg_temp/i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.revise_offer_versioned_deal\(uuid, uuid, uuid, jsonb, jsonb, text, jsonb\)[\s\S]+FROM PUBLIC, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.revise_offer_versioned_deal\(uuid, uuid, uuid, jsonb, jsonb, text, jsonb\)[\s\S]+TO service_role/i,
    );
  });

  it("verifies business ownership inside the rpc, not just at the edge", () => {
    expect(migration).toMatch(/FROM public\.businesses b[\s\S]+b\.owner_id = p_owner_user_id/i);
    expect(migration).toMatch(/ERRCODE = '42501'/);
  });
});

describe("publish-offer-version revise branch", () => {
  it("routes a deal_id to the revise rpc and everything else to the publish rpc", () => {
    expect(functionSource).toMatch(/revise_offer_versioned_deal/);
    expect(functionSource).toMatch(/p_deal_id: reviseDealId/);
    expect(functionSource).toMatch(/p_deal_row: dealRows\[0\]/);
  });

  it("rejects a revision that does not name exactly one real deal of this business", () => {
    expect(functionSource).toMatch(/INVALID_REVISE_DEAL_ROWS/);
    expect(functionSource).toMatch(/REVISE_DEAL_NOT_FOUND/);
    expect(functionSource).toMatch(/existingDeal\.business_id !== businessId/);
  });

  it("runs a revision through the same publish guards as a create", () => {
    // A revision republishes an offer, so billing suspension, verification, terms,
    // capability, and ad-spec validation must all still gate it. They sit above the
    // rpc dispatch, which is the only branch point.
    const dispatchIndex = functionSource.indexOf("const rpcName =");
    expect(dispatchIndex).toBeGreaterThan(0);
    const beforeDispatch = functionSource.slice(0, dispatchIndex);
    expect(beforeDispatch).toMatch(/getSuspendedLocationFromDealRows/);
    expect(beforeDispatch).toMatch(/getUnverifiedLocationFromDealRows/);
    expect(beforeDispatch).toMatch(/TERMS_REQUIRED/);
    expect(beforeDispatch).toMatch(/can_publish_offer/);
    expect(beforeDispatch).toMatch(/validateAdSpecPayload\(adSpec, offerDefinition\)/);
  });

  it("distinguishes revisions in publish telemetry", () => {
    expect(functionSource).toMatch(/publish_mode: reviseDealId \? "revise" : "create"/);
  });
});
