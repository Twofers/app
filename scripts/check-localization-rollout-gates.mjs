#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireBroadProductionReady = process.env.LOCALIZATION_BROAD_PRODUCTION_ROLLOUT === "true";

const read = (relativePath) => {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
};

const checks = [
  {
    name: "typed rollout gate exists",
    file: "lib/localization-rollout-gate.ts",
    pattern: /LOCALIZATION_ROLLOUT_GATE_VERSION\s*=\s*"localization-rollout-gate-v1"/,
  },
  {
    name: "native review log is linked from the gate",
    file: "lib/localization-rollout-gate.ts",
    pattern: /LOCALIZATION_NATIVE_REVIEW_LOG_PATH\s*=\s*"docs\/localization\/native-review-log\.md"/,
  },
  {
    name: "Spanish reviewer remains explicitly TBD before production",
    file: "lib/localization-rollout-gate.ts",
    pattern: /"es-US"[\s\S]+reviewerName:\s*"TBD"[\s\S]+nativeReviewStatus:\s*"native_reviewer_tbd"[\s\S]+nativeScreenshotQaStatus:\s*"pending"/,
  },
  {
    name: "Korean reviewer and counters remain explicitly pending before production",
    file: "lib/localization-rollout-gate.ts",
    patterns: [
      /"ko-KR"[\s\S]+reviewerName:\s*"TBD"[\s\S]+nativeReviewStatus:\s*"native_reviewer_tbd"[\s\S]+nativeScreenshotQaStatus:\s*"pending"/,
      /KOREAN_COUNTER_NATIVE_REVIEW_PENDING/,
    ],
  },
  {
    name: "native review log blocks broad Spanish and Korean production",
    file: "docs/localization/native-review-log.md",
    patterns: [
      /Broad Spanish production use is blocked until a named U\.S\. Spanish reviewer signs off\./,
      /Broad Korean production use is blocked until a named Korean reviewer signs off\./,
      /localization-rollout-gate-v1/,
    ],
  },
  {
    name: "rollout gate handoff document exists",
    file: "docs/localization/multilingual-deals-pr4-rollout-gate.md",
    patterns: [
      /npm run gate:localization-rollout/,
      /LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true/,
      /U\.S\. Spanish and Korean broad production rollout remains blocked/,
    ],
  },
  {
    name: "versioned publish exposes localization rollout telemetry",
    file: "supabase/functions/publish-offer-version/index.ts",
    patterns: [
      /localization_source_locale/,
      /localization_bundle_hash/,
      /deterministic_localization_fallback_locales/,
      /translation_qa_decision_by_locale/,
      /translation_repair_target_locales/,
      /locale_template_override_locales/,
      /localization_approval_hash/,
      /localized_term_snapshot_hash/,
    ],
  },
  {
    name: "rollout telemetry handoff document exists",
    file: "docs/localization/multilingual-deals-pr4-rollout-telemetry.md",
    patterns: [
      /ai_ad_versioned_publish/,
      /source-locale publish mix/,
      /deterministic fallback rate by source locale/,
      /does not record localized headline text/,
    ],
  },
];

let failed = 0;
for (const check of checks) {
  const source = read(check.file);
  const patterns = check.patterns ?? [check.pattern];
  const ok = Boolean(source && patterns.every((pattern) => pattern.test(source)));
  console.log(`${ok ? "PASS" : "FAIL"} ${check.name}`);
  if (!ok) {
    console.log(`  ${check.file}`);
    failed += 1;
  }
}

if (requireBroadProductionReady) {
  const gateSource = read("lib/localization-rollout-gate.ts");
  const stillBlocked =
    /nativeReviewStatus:\s*"native_reviewer_tbd"/.test(gateSource) ||
    /nativeScreenshotQaStatus:\s*"pending"/.test(gateSource) ||
    /reviewerApproved:\s*false/.test(read("lib/korean-counter-registry.ts")) ||
    /reviewStatus:\s*"needs_native_review"/.test(read("lib/offer-locale-templates.ts"));

  if (stillBlocked) {
    console.log("FAIL broad production readiness requested");
    console.log("  Native reviewer sign-off, template review, Korean counter review, or screenshot QA is still pending.");
    failed += 1;
  } else {
    console.log("PASS broad production readiness requested");
  }
}

if (failed > 0) {
  console.error(`\n${failed} localization rollout gate check(s) failed.`);
  process.exit(1);
}

console.log("\nLocalization rollout gate checks passed.");
