import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join("supabase", "migrations");
const OUTPUT_FILE = path.join("docs", "dev", "AI_DEAL_STUDIO_DEV_SCHEMA_BUNDLE.sql");

const SELECTED_MIGRATIONS = [
  "20250127000000_initial_schema.sql",
  "20260127000001_add_deal_templates_and_recurring.sql",
  "20260128120000_business_profile_ai_context.sql",
  "20260129100000_deal_quality_tier.sql",
  "20260130120000_business_preferred_locale.sql",
  "20260323120000_users_read_claimed_deals.sql",
  "20260324120000_business_coordinates.sql",
  "20260324180000_business_consumer_profile_fields.sql",
  "20260325120000_ai_generation_logs.sql",
  "20260325120100_ai_compose_quota_rpc.sql",
  "20260325183000_strong_deal_only_guardrail.sql",
  "20260326120000_consumer_profiles_business_contact.sql",
  "20260326210000_deal_claims_short_code.sql",
  "20260327120000_launch_visual_redeem_analytics.sql",
  "20260328140000_merchant_insights_rpc.sql",
  "20260330120000_fix_deal_claims_deals_rls_recursion.sql",
  "20260330140000_deals_public_read_start_time_deal_templates_timezone.sql",
  "20260331120000_deal_poster_storage_public_read.sql",
  "20260401120000_add_claim_blocked_reason_mix_to_merchant_business_insights.sql",
  "20260401150000_update_strong_deal_guardrail_free_item.sql",
  "20260402120000_push_tokens.sql",
  "20260402130000_server_set_quality_tier.sql",
  "20260403120000_consumer_push_prefs.sql",
  "20260404120000_app_analytics_events_select_business_owner.sql",
  "20260429120000_business_menu_items.sql",
  "20260502120000_profiles_app_tab_mode.sql",
  "20260601000000_create_business_profiles.sql",
  "20260630120000_lockdown_deal_claims_client_insert.sql",
  "20260701120001_enable_rate_limits_rls.sql",
  "20260702120000_deal_translation_columns.sql",
  "20260703120000_add_analytics_business_id_index.sql",
  "20260703120001_push_token_cleanup.sql",
  "20260703120002_birthdate_check_constraint.sql",
  "20260703120003_deal_claims_status_changed_at.sql",
  "20260703120004_timezone_validation.sql",
  "20260703120005_claim_race_guards.sql",
  "20260704120000_business_logo_storage.sql",
  "20260704120001_enable_deals_realtime.sql",
  "20260704130000_enforce_max_claims_atomic.sql",
  "20260705120000_businesses_pii_column_grants.sql",
  "20260705120002_deal_claims_unique_active.sql",
  "20260705120004_deal_claims_dashboard_index.sql",
  "20260705120005_business_profiles_single_row.sql",
  "20260705120006_realtime_publication_insert_only.sql",
  "20260705120007_failed_redeem_attempts.sql",
  "20260705120008_purge_user_data_rpc.sql",
  "20260706120000_business_invite_gate.sql",
  "20260706130000_deal_photo_owner_upload_policies.sql",
  "20260707120000_business_menu_item_sizes.sql",
  "20260707130000_align_strong_deal_guard_with_client.sql",
  "20260708120000_deal_viewed_daily_idempotency.sql",
  "20260708130000_nearby_geo_rpcs.sql",
  "20260708140000_consumer_deal_alerts_enabled.sql",
  "20260710120000_deal_shares.sql",
  "20260711120000_profiles_role.sql",
  "20260713120000_business_claim_notifications.sql",
  "20260714120000_fix_purge_user_data_columns.sql",
  "20260715120000_share_lookup_hardening.sql",
  "20260716120000_deal_claim_counts_rpc.sql",
  "20260718120000_deal_source_locale_and_english_translation.sql",
  "20260722120000_ai_generation_cost_ledger.sql",
  "20260723120000_offer_versions_foundation.sql",
  "20260725120000_ad_generation_media_library.sql",
  "20260725121000_business_media_import_jobs.sql",
  "20260727120000_ai_provider_circuit_breakers.sql",
  "20260730120000_deals_owner_delete_ended.sql",
];

const APPENDED_SQL = [
  path.join("docs", "dev", "ai_deal_studio_dev_business_locations.sql"),
  path.join("docs", "dev", "ai_deal_studio_dev_storage.sql"),
];

const BLOCKED_PATTERNS = [
  { label: "production Supabase host", pattern: /kvodhiqhdqnptqovovia\.supabase\.co/i },
  { label: "pg_cron schedule", pattern: /\bcron\.schedule\b/i },
  { label: "pg_net HTTP call", pattern: /\bnet\.http_post\b/i },
  { label: "Stripe reference", pattern: /\bstripe\b/i },
  { label: "paid billing reference", pattern: /\bbilling\w*\b/i },
  { label: "subscription reference", pattern: /\b\w*subscriptions?\w*\b/i },
  { label: "trial reference", pattern: /\btrial\b/i },
  { label: "entitlement reference", pattern: /\bentitlements?\b/i },
  { label: "deal credit reference", pattern: /\bdeal_credit\b/i },
  { label: "live Stripe key shape", pattern: /\bsk_live_[A-Za-z0-9_]+\b/i },
  { label: "OpenAI key shape", pattern: /\bsk-[A-Za-z0-9]{20,}\b/i },
];

const PAID_SURFACE_TERMS = /\b(billing\w*|\w*subscriptions?\w*|trial|entitlements?|deal_credit)\b/i;

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing expected input: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").trimEnd();
}

function assertNoBlockedContent(label, sql) {
  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.pattern.test(sql)) {
      throw new Error(`${label} contains blocked content: ${blocked.label}`);
    }
  }
}

function stripPaidSurfaceComments(sql) {
  const withoutLineComments = sql
    .split("\n")
    .filter((line) => !(line.trimStart().startsWith("--") && PAID_SURFACE_TERMS.test(line)))
    .join("\n");

  return withoutLineComments.replace(/COMMENT\s+ON[\s\S]*?;/gi, (statement) => {
    return PAID_SURFACE_TERMS.test(statement) ? "" : statement;
  });
}

const header = `-- AI Deal Studio development schema bundle.
-- Generated by scripts/build-ai-studio-dev-schema-bundle.mjs.
-- Apply only to the separate Supabase development project.
-- Do not apply to production.
-- This bundle intentionally excludes production cron, paid surfaces,
-- seed/demo, QA content, and release-push scheduling paths.
-- Generated at: ${new Date().toISOString()}
`;

const chunks = [header];

for (const fileName of SELECTED_MIGRATIONS) {
  const fullPath = path.join(MIGRATIONS_DIR, fileName);
  const sql = stripPaidSurfaceComments(readRequired(fullPath));
  assertNoBlockedContent(fileName, sql);
  chunks.push(`\n\n-- ============================================================\n-- Source migration: ${fileName}\n-- ============================================================\n\n${sql}\n`);
}

for (const filePath of APPENDED_SQL) {
  const sql = stripPaidSurfaceComments(readRequired(filePath));
  assertNoBlockedContent(filePath, sql);
  chunks.push(`\n\n-- ============================================================\n-- Source helper: ${filePath.replaceAll("\\", "/")}\n-- ============================================================\n\n${sql}\n`);
}

const output = chunks.join("");
assertNoBlockedContent(OUTPUT_FILE, output);

fs.writeFileSync(OUTPUT_FILE, output, "utf8");

console.log(JSON.stringify({
  outputFile: OUTPUT_FILE,
  migrationCount: SELECTED_MIGRATIONS.length,
  appendedHelpers: APPENDED_SQL.length,
  bytes: Buffer.byteLength(output, "utf8"),
}, null, 2));
