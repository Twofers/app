import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824140000_revoke_nonpublic_function_anon_execute.sql",
  ),
  "utf8",
);

const nonpublicFunctions = [
  "admin_can",
  "admin_role",
  "ai_compose_quota_status",
  "business_location_count",
  "business_member_role",
  "can_business_publish",
  "cleanup_stale_push_tokens",
  "get_business_capabilities",
  "get_deal_credit_enforcement_enabled",
  "get_location_billing_summary",
  "get_my_business",
  "get_runtime_billing_config",
  "is_admin",
  "is_business_member",
  "is_location_billing_suspended",
  "is_location_entitlement_suspended",
  "is_owner_admin",
  "is_suspended_deal_deactivation_only",
  "location_cap_for_current_user",
  "merchant_business_insights",
  "merchant_deal_insights",
  "resolve_deal_credit_location",
  "user_owns_business",
  "user_owns_business_location",
] as const;

const intentionalAnonymousFunctions = [
  "customer_deal_localizations",
  "customer_deal_poster_specs",
  "deal_claim_visible_to_business_owner",
  "is_publicly_visible_business",
  "lookup_deal_share",
  "public_local_businesses",
  "user_has_business_claim",
] as const;

describe("nonpublic function anonymous execution hardening migration", () => {
  it("revokes PUBLIC and anon execution from all 24 nonpublic functions", () => {
    expect(nonpublicFunctions).toHaveLength(24);

    for (const functionName of nonpublicFunctions) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?\\) FROM PUBLIC, anon`,
          "i",
        ),
      );
    }

    expect(migration.match(/REVOKE EXECUTE ON FUNCTION/gi)).toHaveLength(24);
  });

  it("preserves the seven functions required by anonymous policies and product flows", () => {
    expect(intentionalAnonymousFunctions).toHaveLength(7);

    for (const functionName of intentionalAnonymousFunctions) {
      expect(migration).not.toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${functionName}\\(`, "i"),
      );
    }
  });

  it("preserves authenticated and service-role execution and does not mutate data", () => {
    expect(migration).not.toMatch(/FROM[^;]+authenticated/i);
    expect(migration).not.toMatch(/FROM[^;]+service_role/i);
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
  });
});
