import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824135000_revoke_service_role_function_client_execute.sql",
  ),
  "utf8",
);

const serviceRoleOnlyFunctions = [
  "admin_account_directory",
  "admin_grant_location_trial",
  "billing_trial_reminder_cron_status",
  "check_business_location_trial_reuse",
  "commit_location_deal_credit",
  "consume_location_deal_credit",
  "consume_trial_no_card_exemption_code",
  "deal_release_push_cron_status",
  "end_expired_deals",
  "end_expired_deals_cron_status",
  "expire_billing_access_cron_status",
  "get_business_verification_required_for_publish",
  "is_business_location_publish_verified",
  "record_business_demand_signal",
  "refresh_business_location_identity",
  "release_expired_deal_credit_reservations",
  "release_location_deal_credit",
  "reserve_location_deal_credit",
  "verify_billing_reminder_secret",
  "verify_deal_release_push_secret",
  "verify_weekly_digest_secret",
  "weekly_digest_cron_status",
] as const;

describe("service-role function execution hardening migration", () => {
  it("revokes all 22 functions from direct client execution", () => {
    expect(serviceRoleOnlyFunctions).toHaveLength(22);

    for (const functionName of serviceRoleOnlyFunctions) {
      expect(migration).toMatch(
        new RegExp(
          `REVOKE EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?\\)\\s+FROM PUBLIC, anon, authenticated;`,
          "i",
        ),
      );
    }

    expect(migration.match(/REVOKE EXECUTE ON FUNCTION/gi)).toHaveLength(22);
  });

  it("does not alter functions, grant new access, or mutate data", () => {
    expect(migration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
    );
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
  });
});
