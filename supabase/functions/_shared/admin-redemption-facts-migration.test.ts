import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260802142000_admin_redemption_facts_view.sql"),
  "utf8",
);

describe("admin redemption facts view migration", () => {
  it("creates the canonical admin redemption facts view from deal_claims", () => {
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.admin_redemption_facts_v1/i);
    expect(migration).toMatch(/FROM public\.deal_claims dc/i);
    expect(migration).toMatch(/WITH \(security_barrier = true\)/i);
  });

  it("uses the North Star redemption filter", () => {
    expect(migration).toMatch(/WHERE dc\.redeemed_at IS NOT NULL\s+AND dc\.claim_status = 'redeemed'/i);
  });

  it("exposes stable admin aliases for offer and customer identifiers", () => {
    expect(migration).toMatch(/dc\.id AS claim_id/i);
    expect(migration).toMatch(/dc\.deal_id AS offer_id/i);
    expect(migration).toMatch(/dc\.user_id AS customer_user_id/i);
    expect(migration).toMatch(/dc\.created_at AS claimed_at/i);
    expect(migration).toMatch(/dc\.location_id AS claim_location_id/i);
  });

  it("includes optional redemption metadata columns already present in the repo schema", () => {
    for (const column of [
      "offer_version_id",
      "redeemed_by_business_user_id",
      "redeemed_at_business_id",
      "redeemed_at_location_id",
      "status_changed_at",
    ]) {
      expect(migration).toContain(`dc.${column}`);
    }
  });

  it("keeps the view service-role only", () => {
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.admin_redemption_facts_v1 FROM PUBLIC/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.admin_redemption_facts_v1 FROM anon/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.admin_redemption_facts_v1 FROM authenticated/i);
    expect(migration).toMatch(/GRANT SELECT ON TABLE public\.admin_redemption_facts_v1 TO service_role/i);
  });

  it("documents that normal clients should not use the view", () => {
    expect(migration).toMatch(/Canonical admin reporting surface for redeemed deals/i);
    expect(migration).toMatch(/Not exposed to normal clients/i);
  });
});
