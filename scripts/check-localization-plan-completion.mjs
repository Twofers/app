#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function extractRepoPathReferences(markdown) {
  const refs = new Set();
  for (const match of markdown.matchAll(/`([^`]+)`/g)) {
    const value = match[1].trim();
    const looksLikeRepoFile =
      value === ".env.example" ||
      /^(app|components|docs|lib|scripts|supabase)\/.+\.(md|mjs|sql|ts|tsx)$/.test(value) ||
      /^package\.json$/.test(value);
    if (looksLikeRepoFile) refs.add(value);
  }
  return [...refs].sort();
}

const checks = [
  {
    name: "plan completion audit document exists and states signed-off non-deployed status",
    file: "docs/localization/multilingual-deals-plan-completion-audit.md",
    patterns: [
      /# Multilingual Deals Plan Completion Audit/,
      /Current status: local implementation checkpoint with Spanish and Korean reviewer sign-off recorded\. Not deployed to production\./,
      /No Supabase migration was applied, no Edge Function was redeployed, no hosted feature flag was changed/,
      /LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true npm run gate:localization-rollout/,
    ],
  },
  {
    name: "PR1 foundation evidence is represented",
    file: "docs/localization/multilingual-deals-plan-completion-audit.md",
    patterns: [
      /## PR 1 Matrix/,
      /Supported locale types[\s\S]+lib\/supported-locales\.ts/,
      /Deterministic offer renderers[\s\S]+lib\/localized-offer-renderer\.ts/,
      /Korean counter registry and fallback[\s\S]+lib\/korean-counter-registry\.ts/,
    ],
  },
  {
    name: "PR2 owner and customer locale evidence is represented",
    file: "docs/localization/multilingual-deals-plan-completion-audit.md",
    patterns: [
      /## PR 2 Matrix/,
      /Deal-detail language selector[\s\S]+app\/deal\/\[id\]\.tsx/,
      /Customer preferred locale[\s\S]+lib\/customer-deal-locale-storage\.ts/,
      /Real-device typography tests[\s\S]+Local reviewer evidence recorded for the localization gate/,
    ],
  },
  {
    name: "PR3 transcreation and storage evidence is represented",
    file: "docs/localization/multilingual-deals-plan-completion-audit.md",
    patterns: [
      /## PR 3 Matrix/,
      /Independent translation QA[\s\S]+AD_LOCALIZATION_SEMANTIC_QA_PROMPT_VERSION/,
      /Targeted repair[\s\S]+repairAdLocalizationTranscreation/,
      /Localization storage and hashes[\s\S]+20260728120000_ad_localization_storage\.sql/,
    ],
  },
  {
    name: "PR4 approval and rollout evidence is represented",
    file: "docs/localization/multilingual-deals-plan-completion-audit.md",
    patterns: [
      /## PR 4 Matrix/,
      /Publish enforcement[\s\S]+supabase\/functions\/publish-offer-version\/index\.ts/,
      /Removal of legacy untranslated customer paths[\s\S]+lib\/customer-localized-paths-source\.test\.ts/,
      /Native-speaker acceptance review[\s\S]+Reviewer sign-off recorded/,
    ],
  },
  {
    name: "required automated test groups are mapped",
    file: "docs/localization/multilingual-deals-plan-completion-audit.md",
    patterns: [
      /## Required Automated Test Coverage/,
      /28\.1 Source locale/,
      /28\.5 Transcreation/,
      /28\.9 Approval and publishing/,
      /28\.10 Viewer-language push and Share Deal/,
    ],
  },
  {
    name: "completion blockers are explicit",
    file: "docs/localization/multilingual-deals-plan-completion-audit.md",
    patterns: [
      /Dan explicitly approves applying the localization migrations/,
      /Dan explicitly approves redeploying affected Edge Functions/,
      /iOS\/TestFlight and store-release QA are completed/,
    ],
  },
  {
    name: "runtime flags expose the local multilingual gates",
    file: "lib/runtime-env.ts",
    patterns: [
      /AI_V5_LOCALIZED_OWNER_UI_ENABLED/,
      /AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED/,
      /AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED/,
      /AI_V5_LOCALE_SCREENSHOT_QA_ENABLED/,
    ],
  },
  {
    name: "local transcreation provider includes semantic QA and targeted repair",
    file: "supabase/functions/_shared/ai-localization-provider.ts",
    patterns: [
      /AD_LOCALIZATION_SEMANTIC_QA_PROMPT_VERSION/,
      /buildAdLocalizationRepairPrompt/,
      /repairAdLocalizationTranscreation/,
      /generateVerifiedAdLocalizationBundle/,
    ],
  },
  {
    name: "customer rendering uses the customer-safe localization projection path",
    file: "lib/customer-deal-localizations.ts",
    patterns: [/customer_deal_localizations/, /fetchCustomerDealLocalizations/, /expectedLocale/],
  },
  {
    name: "rollout gate records broad Spanish and Korean localization signoff",
    file: "lib/localization-rollout-gate.ts",
    patterns: [
      /"es-US"[\s\S]+reviewerName:\s*"Juan"[\s\S]+nativeReviewStatus:\s*"native_reviewer_signed_off"[\s\S]+nativeScreenshotQaStatus:\s*"passed"/,
      /"ko-KR"[\s\S]+reviewerName:\s*"June"[\s\S]+nativeReviewStatus:\s*"native_reviewer_signed_off"[\s\S]+nativeScreenshotQaStatus:\s*"passed"/,
    ],
  },
  {
    name: "viewer-language push policy remains guarded",
    file: "supabase/functions/_shared/send-deal-push-source.test.ts",
    patterns: [
      /send-deal-push multilingual rollout source guards/,
      /buildDealReleasePushCopy/,
      /fetchProfileLocaleByUserId/,
      /not\.toMatch\(\/customer_deal_localizations\//,
    ],
  },
  {
    name: "Share Deal landing resolves viewer locale",
    file: "supabase/functions/_shared/deal-link-viewer-locale-source.test.ts",
    patterns: [
      /deal-link viewer-language source guards/,
      /resolveViewerLocaleFromRequest/,
      /buildPublicDealDisplay/,
      /not\.toMatch\(\/getDealDisplayTitle\//,
    ],
  },
];

let failed = 0;

for (const check of checks) {
  const source = read(check.file);
  const ok = source.length > 0 && check.patterns.every((pattern) => pattern.test(source));
  console.log(`${ok ? "PASS" : "FAIL"} ${check.name}`);
  if (!ok) {
    console.log(`  ${check.file}`);
    failed += 1;
  }
}

const auditSource = read("docs/localization/multilingual-deals-plan-completion-audit.md");
const referencedPaths = extractRepoPathReferences(auditSource);
const missingReferencedPaths = referencedPaths.filter((relativePath) => !exists(relativePath));

if (referencedPaths.length > 0 && missingReferencedPaths.length === 0) {
  console.log("PASS audit evidence path references exist");
} else {
  console.log("FAIL audit evidence path references exist");
  for (const missingPath of missingReferencedPaths) {
    console.log(`  missing: ${missingPath}`);
  }
  if (referencedPaths.length === 0) console.log("  no repo path references found");
  failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} localization plan completion audit check(s) failed.`);
  process.exit(1);
}

console.log("\nLocalization plan completion audit checks passed.");
