#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const checks = [
  {
    name: "current-state audit exists",
    file: "docs/ai-ad-current-state.md",
    pattern: /current data flow|claim\/redemption|gaps/i,
  },
  {
    name: "baseline metrics runner documented",
    file: "docs/ai-ad-baseline-metrics.md",
    pattern: /measure-ai-ad-baseline|SUPABASE_SERVICE_ROLE_KEY|baseline/i,
  },
  {
    name: "AdSpec builder keeps critical text native",
    file: "lib/ad-spec.ts",
    pattern: /criticalTextRenderedNatively:\s*true[\s\S]+dynamicBindings[\s\S]+remainingClaims/,
  },
  {
    name: "versioned publish is idempotent",
    file: "supabase/migrations/20260724120000_offer_version_publish_rpc.sql",
    pattern: /UNIQUE \(business_id, idempotency_key\)[\s\S]+publish_offer_versioned_deal/,
  },
  {
    name: "approved AdSpec is stored with OfferVersion",
    file: "supabase/migrations/20260724120000_offer_version_publish_rpc.sql",
    pattern: /offer_versions[\s\S]+ADD COLUMN IF NOT EXISTS ad_spec jsonb[\s\S]+p_ad_spec/,
  },
  {
    name: "claims copy immutable offer ids",
    file: "supabase/functions/claim-deal/index.ts",
    pattern: /offer_definition_id[\s\S]+offer_version_id[\s\S]+claimInsertRow/,
  },
  {
    name: "claim inventory guard returns sold-out response",
    file: "supabase/functions/claim-deal/index.ts",
    pattern: /MAX_CLAIMS_REACHED\|CLAIM_LIMIT_REACHED[\s\S]+This deal has reached its claim limit\./,
  },
  {
    name: "redemption telemetry includes offer version",
    file: "supabase/functions/redeem-token/index.ts",
    pattern: /redeem_completed[\s\S]+offer_definition_id[\s\S]+offer_version_id/,
  },
  {
    name: "versioned publish telemetry is allowed",
    file: "supabase/functions/ingest-analytics-event/index.ts",
    pattern: /ai_ad_quality_gate_failed[\s\S]+ai_ad_versioned_publish/,
  },
];

let failed = 0;
for (const check of checks) {
  const filePath = path.join(root, check.file);
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const ok = Boolean(source && check.pattern.test(source));
  console.log(`${ok ? "PASS" : "FAIL"} ${check.name}`);
  if (!ok) {
    console.log(`  ${check.file}`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`\n${failed} AI ad release gate check(s) failed.`);
  process.exit(1);
}

console.log("\nAI ad release gate checks passed.");
