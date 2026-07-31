import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824141000_revoke_internal_helper_client_execute.sql",
  ),
  "utf8",
);

const internalHelpers = [
  "cleanup_stale_push_tokens",
  "get_deal_credit_enforcement_enabled",
  "is_location_billing_suspended",
  "is_location_entitlement_suspended",
  "is_suspended_deal_deactivation_only",
  "resolve_deal_credit_location",
] as const;

describe("internal helper client execution hardening migration", () => {
  it("revokes direct client execution from all six internal helpers", () => {
    expect(internalHelpers).toHaveLength(6);

    for (const functionName of internalHelpers) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?\\)\\s+FROM PUBLIC, anon, authenticated;`,
          "i",
        ),
      );
    }

    expect(migration.match(/REVOKE EXECUTE ON FUNCTION/gi)).toHaveLength(6);
  });

  it("does not alter functions, jobs, triggers, grants, or data", () => {
    expect(migration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER)\b/i,
    );
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
  });

  it("does not change the intentionally client-facing RPC set", () => {
    expect(migration).not.toMatch(
      /(?:admin_can|customer_deal_localizations|customer_deal_poster_specs|deal_claim_counts|get_location_billing_summary|get_my_business|lookup_deal_share|merchant_business_insights|merchant_deal_insights|public_local_businesses|report_business|report_user|validate_business_invite)/i,
    );
  });
});
