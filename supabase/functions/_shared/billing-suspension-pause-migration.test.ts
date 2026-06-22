import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726134000_pause_recurring_deals_on_billing_suspension.sql"),
  "utf8",
);

describe("billing suspension recurring pause migration", () => {
  it("adds a trigger for first entry into a suspended entitlement state", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.pause_recurring_deals_on_billing_suspension/i);
    expect(migration).toMatch(/AFTER INSERT OR UPDATE OF status, suspended_at ON public\.location_entitlements/i);
    expect(migration).toMatch(/v_now_suspended AND NOT v_was_suspended/i);
    expect(migration).toMatch(/payment_failed_suspended/i);
    expect(migration).toMatch(/refunded_suspended/i);
  });

  it("pauses only active recurring deals for the suspended location", () => {
    expect(migration).toMatch(/UPDATE public\.deals/i);
    expect(migration).toMatch(/SET is_active = false,\s*deal_status = 'PAUSED'/i);
    expect(migration).toMatch(/WHERE location_id = NEW\.business_location_id/i);
    expect(migration).toMatch(/COALESCE\(is_recurring, false\) = true/i);
    expect(migration).toMatch(/COALESCE\(is_active, false\) = true/i);
    expect(migration).toMatch(/COALESCE\(deal_status, 'LIVE'\) <> 'ENDED'/i);
  });

  it("does not expose trigger helpers to app users", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.pause_recurring_deals_on_billing_suspension\(\) FROM PUBLIC/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_location_entitlement_suspended\(text, timestamptz\) TO service_role/i);
    expect(migration).not.toMatch(/TO authenticated/i);
  });
});
