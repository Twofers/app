#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireBroadProductionReady = process.env.LOCALIZATION_BROAD_PRODUCTION_ROLLOUT === "true";
const NATIVE_ACCEPTANCE_PACKET_PATH = "docs/localization/multilingual-deals-native-acceptance-packet.md";

const REQUIRED_NATIVE_ACCEPTANCE_SCENARIOS = [
  ["NA-001", "English owner -> Spanish and Korean customers"],
  ["NA-002", "Spanish owner -> English and Korean customers"],
  ["NA-003", "Korean owner -> English and Spanish customers"],
  ["NA-004", "Coffee drink"],
  ["NA-005", "Pastry"],
  ["NA-006", "Meal with two different items"],
  ["NA-007", "Retail product"],
  ["NA-008", "Service"],
  ["NA-009", "Branded English item name"],
  ["NA-010", "Hangul item name"],
  ["NA-011", "Spanish item name"],
  ["NA-012", "Unknown Korean counter"],
  ["NA-013", "Long Spanish headline"],
  ["NA-014", "Long Korean item term"],
  ["NA-015", "Mixed protected term"],
  ["NA-016", "Live quantity-limited offer"],
  ["NA-017", "Scheduled offer"],
  ["NA-018", "Deterministic fallback"],
  ["NA-019", "No merchant photo"],
  ["NA-020", "Busy merchant photo"],
  ["NA-021", "Small iPhone"],
  ["NA-022", "Small Android"],
  ["NA-023", "Accessibility text size"],
];

const REQUIRED_NATIVE_ACCEPTANCE_QUESTIONS = [
  "Is the exact offer correct?",
  "Does this sound native rather than translated?",
  "Is the level of politeness appropriate?",
  "Are protected names handled correctly?",
  "Are Korean counters and spacing correct?",
  "Can the offer be understood in two seconds?",
  "Does the card fit without awkward density?",
  "Would a business owner be comfortable publishing it?",
];

const REQUIRED_NATIVE_ACCEPTANCE_EVIDENCE_RULES = [
  "Store raw screenshots only under local `artifacts/` folders",
  "Do not transcribe QR tokens, claim codes, redemption codes",
  "Customer viewing must use approved stored localizations and must not make a model call",
  "docs/localization/native-review-log.md",
  "LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true npm run gate:localization-rollout",
];

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
    name: "native acceptance packet exists",
    file: NATIVE_ACCEPTANCE_PACKET_PATH,
    patterns: [
      /# Multilingual Deals Native Acceptance Packet/,
      /English owner -> Spanish and Korean customers/,
      /Spanish owner -> English and Korean customers/,
      /Korean owner -> English and Spanish customers/,
      /Coffee drink/,
      /Unknown Korean counter/,
      /Small iPhone/,
      /Small Android/,
      /Accessibility text size/,
      /Is the exact offer correct\?/,
      /Does this sound native rather than translated\?/,
      /Are Korean counters and spacing correct\?/,
      /Would a business owner be comfortable publishing it\?/,
      /QR tokens, claim codes, redemption codes/,
      /docs\/localization\/native-review-log\.md/,
      /LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true npm run gate:localization-rollout/,
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

const nativeAcceptancePacketSource = read(NATIVE_ACCEPTANCE_PACKET_PATH);
const nativeAcceptanceScenarioSection =
  nativeAcceptancePacketSource.split("## Scenario Matrix")[1]?.split("## Reviewer Questions")[0] ?? "";
const nativeAcceptanceQuestionSection =
  nativeAcceptancePacketSource.split("## Reviewer Questions")[1]?.split("## Evidence Manifest Template")[0] ?? "";
const nativeAcceptanceScenarioRows = nativeAcceptanceScenarioSection
  .split(/\r?\n/)
  .filter((line) => /^\|\s*NA-\d{3}\s*\|/.test(line));
const nativeAcceptanceQuestionRows = nativeAcceptanceQuestionSection
  .split(/\r?\n/)
  .filter((line) => /^\|\s*(Is|Does|Are|Can|Would)\b/.test(line));
const missingNativeAcceptanceScenarios = REQUIRED_NATIVE_ACCEPTANCE_SCENARIOS.filter(
  ([scenarioId, label]) =>
    !new RegExp(`\\|\\s*${scenarioId}\\s*\\|\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`).test(
      nativeAcceptanceScenarioSection,
    ),
);
const missingNativeAcceptanceQuestions = REQUIRED_NATIVE_ACCEPTANCE_QUESTIONS.filter(
  (question) => !nativeAcceptanceQuestionSection.includes(`| ${question} |`),
);
const missingNativeAcceptanceEvidenceRules = REQUIRED_NATIVE_ACCEPTANCE_EVIDENCE_RULES.filter(
  (rule) => !nativeAcceptancePacketSource.includes(rule),
);
const nativeAcceptanceScenarioCountMatches =
  nativeAcceptanceScenarioRows.length === REQUIRED_NATIVE_ACCEPTANCE_SCENARIOS.length;
const nativeAcceptanceQuestionCountMatches =
  nativeAcceptanceQuestionRows.length === REQUIRED_NATIVE_ACCEPTANCE_QUESTIONS.length;

if (
  nativeAcceptancePacketSource &&
  missingNativeAcceptanceScenarios.length === 0 &&
  missingNativeAcceptanceQuestions.length === 0 &&
  missingNativeAcceptanceEvidenceRules.length === 0 &&
  nativeAcceptanceScenarioCountMatches &&
  nativeAcceptanceQuestionCountMatches
) {
  console.log("PASS native acceptance packet covers required scenarios and questions");
} else {
  console.log("FAIL native acceptance packet covers required scenarios and questions");
  if (!nativeAcceptancePacketSource) console.log(`  ${NATIVE_ACCEPTANCE_PACKET_PATH}`);
  if (!nativeAcceptanceScenarioCountMatches) {
    console.log(
      `  scenario row count: ${nativeAcceptanceScenarioRows.length}/${REQUIRED_NATIVE_ACCEPTANCE_SCENARIOS.length}`,
    );
  }
  if (!nativeAcceptanceQuestionCountMatches) {
    console.log(
      `  reviewer question row count: ${nativeAcceptanceQuestionRows.length}/${REQUIRED_NATIVE_ACCEPTANCE_QUESTIONS.length}`,
    );
  }
  for (const [scenarioId, label] of missingNativeAcceptanceScenarios) {
    console.log(`  missing scenario: ${scenarioId} ${label}`);
  }
  for (const question of missingNativeAcceptanceQuestions) {
    console.log(`  missing question: ${question}`);
  }
  for (const rule of missingNativeAcceptanceEvidenceRules) {
    console.log(`  missing evidence rule: ${rule}`);
  }
  failed += 1;
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
