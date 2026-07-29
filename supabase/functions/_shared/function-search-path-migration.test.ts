import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824133000_pin_remaining_function_search_paths.sql",
  ),
  "utf8",
);

const functions = [
  "cleanup_stale_push_tokens",
  "enforce_deal_max_claims",
  "enforce_strong_deal_only_guardrail",
  "get_best_time_day",
  "get_business_dashboard",
  "haversine_miles",
  "is_public_business_status",
  "is_redeemer_session",
  "is_strong_deal_offer",
  "is_valid_iana_timezone",
  "nearby_businesses",
  "nearby_deals",
  "normalize_business_identity_domain",
  "normalize_business_identity_phone",
  "normalize_business_identity_text",
  "prospect_public_label_text",
  "rate_limit_hit",
  "redeemer_business_id",
  "redeemer_device_id",
  "redemption_claim_input_kind",
  "set_admin_ai_prompts_updated_at",
  "set_claim_status_changed_at",
  "set_quality_tier_on_deal",
  "set_updated_at",
  "structured_offer_is_strong",
] as const;

describe("function search-path hardening migration", () => {
  it("pins all 25 Advisor findings to pg_catalog and public", () => {
    expect(functions).toHaveLength(25);

    for (const functionName of functions) {
      expect(migration).toMatch(
        new RegExp(
          `ALTER FUNCTION public\\.${functionName}\\([\\s\\S]*?\\)\\s+SET search_path = pg_catalog, public;`,
          "i",
        ),
      );
    }

    expect(
      migration.match(/SET search_path = pg_catalog, public;/gi),
    ).toHaveLength(25);
  });

  it("does not replace bodies, change grants, or mutate data", () => {
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION/i);
    expect(migration).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i,
    );
  });
});
