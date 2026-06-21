import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726125000_deal_suspension_write_guards.sql"),
  "utf8",
);

describe("deal suspension write guards migration", () => {
  it("adds a helper that recognizes suspended location entitlement states", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.is_location_billing_suspended/i);
    expect(migration).toMatch(/le\.suspended_at IS NOT NULL/i);
    expect(migration).toMatch(/payment_failed_suspended/i);
    expect(migration).toMatch(/refunded_suspended/i);
  });

  it("blocks direct deal inserts and updates through a database trigger", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.block_suspended_location_deal_write/i);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE ON public\.deals/i);
    expect(migration).toMatch(/v_new_location_id := public\.resolve_deal_credit_location\(NEW\.business_id, NEW\.location_id\)/i);
    expect(migration).toMatch(/v_old_location_id := public\.resolve_deal_credit_location\(OLD\.business_id, OLD\.location_id\)/i);
    expect(migration).toMatch(/v_location_suspended :=\s*public\.is_location_billing_suspended\(v_new_location_id\)/i);
    expect(migration).toMatch(/OR public\.is_location_billing_suspended\(v_old_location_id\)/i);
    expect(migration).toMatch(/LOCATION_BILLING_SUSPENDED/i);
  });

  it("allows pause and end updates without allowing broader edits", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.is_suspended_deal_deactivation_only/i);
    expect(migration).toMatch(/COALESCE\(p_new_is_active, false\) = false/i);
    expect(migration).toMatch(/p_new_deal_status IN \('PAUSED', 'ENDED'\)/i);
    expect(migration).toMatch(/p_new_row - 'is_active' - 'end_time' - 'deal_status' - 'updated_at'/i);
    expect(migration).toMatch(/p_old_row - 'is_active' - 'end_time' - 'deal_status' - 'updated_at'/i);
  });

  it("does not expose mutation trigger helpers to app users", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.block_suspended_location_deal_write\(\) FROM PUBLIC/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_location_billing_suspended\(uuid\) TO service_role/i);
    expect(migration).not.toMatch(/TO authenticated/i);
  });
});
