import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824134000_revoke_trigger_function_client_execute.sql",
  ),
  "utf8",
);

const triggerFunctions = [
  "audit_app_runtime_config",
  "block_suspended_location_deal_write",
  "businesses_require_invite",
  "charge_deal_credit_after_insert",
  "enforce_business_menu_capability",
  "enforce_business_workspace_capability",
  "enforce_credit_reservation_business_capability",
  "enforce_live_deal_business_capability",
  "enforce_new_claim_business_capability",
  "enforce_profiles_role_immutable",
  "ensure_location_entitlement",
  "pause_recurring_deals_on_billing_suspension",
  "set_deal_credit_location_before_insert",
] as const;

describe("trigger-function direct execution hardening migration", () => {
  it("revokes direct execution from all client roles for all 13 functions", () => {
    expect(triggerFunctions).toHaveLength(13);

    for (const functionName of triggerFunctions) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE EXECUTE ON FUNCTION public\\.${functionName}\\(\\)\\s+FROM PUBLIC, anon, authenticated;`,
          "i",
        ),
      );
    }

    expect(migration.match(/REVOKE EXECUTE ON FUNCTION/gi)).toHaveLength(13);
  });

  it("does not alter trigger bindings, function bodies, grants, or data", () => {
    expect(migration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER)\b/i,
    );
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
  });
});
