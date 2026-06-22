import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726133000_business_publish_verification_controls.sql"),
  "utf8",
);

describe("business publish verification migration", () => {
  it("adds a dormant runtime switch for publish verification", () => {
    expect(migration).toMatch(/business_verification_required_for_publish boolean NOT NULL DEFAULT false/i);
    expect(migration).toMatch(/get_business_verification_required_for_publish/i);
  });

  it("allows verified identities and active billing-backed locations", () => {
    expect(migration).toMatch(/verification_status = 'verified'/i);
    expect(migration).toMatch(/'trial_active'/i);
    expect(migration).toMatch(/'pro_active'/i);
    expect(migration).toMatch(/entitlement_provider IN \('stripe', 'admin_grant'\)/i);
  });

  it("keeps publish verification checks service-role only", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.is_business_location_publish_verified\(uuid\) FROM PUBLIC/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_business_location_publish_verified\(uuid\) TO service_role/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.is_business_location_publish_verified\(uuid\) TO authenticated/i);
  });
});
