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
    name: "selective locale screenshot QA is wired into owner approval",
    file: "app/create/ai.tsx",
    patterns: [
      /isAiV5LocaleScreenshotQaEnabled/,
      /resolveLocalePresentationOverrides/,
      /selectedLocaleScreenshotQaTriggerLocales/,
      /locale_screenshot_qa_trigger_locales/,
      /screenshotQaRequired:\s*selectedComposedScreenshotQaRequired/,
    ],
  },
  {
    name: "locale screenshot QA rollout flag is documented",
    file: "lib/runtime-env.ts",
    patterns: [
      /AI_V5_LOCALE_SCREENSHOT_QA_ENABLED/,
      /EXPO_PUBLIC_AI_V5_LOCALE_SCREENSHOT_QA_ENABLED/,
      /isAiV5LocaleScreenshotQaEnabled/,
    ],
  },
  {
    name: "locale screenshot QA handoff document exists",
    file: "docs/localization/multilingual-deals-pr4-locale-screenshot-qa.md",
    patterns: [
      /AI_V5_LOCALE_SCREENSHOT_QA_ENABLED/,
      /selective/,
      /localized text-fit failure/,
      /Real-device screenshot capture/,
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
  {
    name: "rollout dashboard command is available",
    file: "package.json",
    patterns: [
      /"dashboard:localization-rollout":\s*"node scripts\/generate-localization-rollout-dashboard\.mjs"/,
    ],
  },
  {
    name: "rollout dashboard generator reports readiness and telemetry fields",
    file: "scripts/generate-localization-rollout-dashboard.mjs",
    patterns: [
      /Localization Rollout Dashboard/,
      /TELEMETRY_FIELDS/,
      /localization_source_locale/,
      /localization_approval_hash/,
      /NATIVE_REVIEWER_TBD/,
      /REAL_DEVICE_SCREENSHOT_QA_PENDING/,
      /KOREAN_COUNTER_NATIVE_REVIEW_PENDING/,
    ],
  },
  {
    name: "rollout dashboard handoff document exists",
    file: "docs/localization/multilingual-deals-pr4-rollout-dashboard.md",
    patterns: [
      /npm run dashboard:localization-rollout/,
      /source\/readiness dashboard/,
      /U\.S\. Spanish remains blocked/,
      /Korean remains blocked/,
    ],
  },
  {
    name: "no multilingual push policy is guarded",
    file: "supabase/functions/_shared/send-deal-push-source.test.ts",
    patterns: [
      /send-deal-push multilingual rollout source guards/,
      /buildDeterministicDealChannelCopy/,
      /not\.toMatch\(\/generateStructuredText\//,
      /not\.toMatch\(\/customer_deal_localizations\//,
      /not\.toMatch\(\/title_es\|title_ko\|description_es\|description_ko\//,
    ],
  },
  {
    name: "no multilingual push handoff document exists",
    file: "docs/localization/multilingual-deals-pr4-no-multilingual-push.md",
    patterns: [
      /push delivery is not multilingual/,
      /Do not claim push notifications are multilingual/,
      /Do not call translation/,
      /Feed and deal-detail localization remain independent from push delivery/,
    ],
  },
  {
    name: "production approval runbook exists",
    file: "docs/localization/multilingual-deals-production-approval-runbook.md",
    patterns: [
      /Hard Gates Before Broad Production/,
      /npm run gate:localization-plan/,
      /20260728120000_ad_localization_storage\.sql/,
      /20260728123000_customer_deal_localization_projection\.sql/,
      /npx supabase functions deploy ai-generate-ad-variants/,
      /npx supabase functions deploy publish-offer-version/,
      /AI_V5_EXACT_LOCALIZATION_APPROVAL_ENABLED/,
      /Customer viewing must not make a model call/,
      /Do not deploy `send-deal-push` to claim multilingual push support/,
    ],
  },
  {
    name: "plan completion audit gate exists",
    file: "docs/localization/multilingual-deals-plan-completion-audit.md",
    patterns: [
      /# Multilingual Deals Plan Completion Audit/,
      /## PR 1 Matrix/,
      /## PR 2 Matrix/,
      /## PR 3 Matrix/,
      /## PR 4 Matrix/,
      /## Required Automated Test Coverage/,
      /## Completion Blockers/,
      /npm run gate:localization-plan/,
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
