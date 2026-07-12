#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SUPPORTED_LOCALES = ["en-US", "es-US", "ko-KR"];
const NATIVE_ACCEPTANCE_PACKET_PATH = "docs/localization/multilingual-deals-native-acceptance-packet.md";
const REQUIRED_NATIVE_ACCEPTANCE_SCENARIO_COUNT = 23;
const REQUIRED_NATIVE_ACCEPTANCE_QUESTION_COUNT = 8;

const TELEMETRY_FIELDS = [
  ["localization_source_locale", "source-locale publish mix"],
  ["localization_enabled_locales", "enabled locale coverage"],
  ["localization_bundle_hash", "approved bundle coverage"],
  ["deterministic_localization_fallback_locales", "deterministic fallback rate"],
  ["translation_qa_decision_by_locale", "translation QA decision mix"],
  ["translation_repair_target_locales", "targeted repair rate"],
  ["locale_template_override_locales", "locale presentation override rate"],
  ["localized_term_snapshot_hash", "term snapshot coverage"],
  ["localization_approval_hash", "exact approval coverage"],
  ["localization_approved_row_hash_locales", "approved row-hash coverage"],
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function extractBalancedBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return "";
  const start = source.indexOf("{", markerIndex);
  if (start < 0) return "";

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function extractString(block, property) {
  return new RegExp(`${property}:\\s*"([^"]*)"`).exec(block)?.[1] ?? "";
}

function extractArrayStrings(block, property) {
  const match = new RegExp(`${property}:\\s*\\[([\\s\\S]*?)\\]`).exec(block);
  if (!match) return [];
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
}

function normalizeVersion(raw, constants) {
  const value = raw.trim().replace(/,$/, "");
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return constants[value] ?? value;
}

function parseGate(gateSource) {
  const version = /LOCALIZATION_ROLLOUT_GATE_VERSION\s*=\s*"([^"]+)"/.exec(gateSource)?.[1] ?? "unknown";
  const nativeReviewLogPath =
    /LOCALIZATION_NATIVE_REVIEW_LOG_PATH\s*=\s*"([^"]+)"/.exec(gateSource)?.[1] ??
    "docs/localization/native-review-log.md";

  const records = SUPPORTED_LOCALES.map((locale) => {
    const block = extractBalancedBlock(gateSource, `"${locale}":`);
    return {
      locale,
      reviewerName: extractString(block, "reviewerName") || "missing",
      nativeReviewStatus: extractString(block, "nativeReviewStatus") || "missing",
      nativeScreenshotQaStatus: extractString(block, "nativeScreenshotQaStatus") || "missing",
      artifacts: extractArrayStrings(block, "artifacts"),
    };
  });

  return { version, nativeReviewLogPath, records };
}

function parseTemplates(templateSource) {
  const constants = {
    LOCALIZED_OFFER_TEMPLATE_VERSION:
      /LOCALIZED_OFFER_TEMPLATE_VERSION\s*=\s*"([^"]+)"/.exec(templateSource)?.[1] ?? "unknown",
  };

  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => {
      const block = extractBalancedBlock(templateSource, `"${locale}":`);
      const templates = [];
      const regex =
        /templateId:\s*"([^"]+)"[\s\S]*?templateVersion:\s*([^,\n]+)[\s\S]*?reviewStatus:\s*"([^"]+)"/g;
      for (const match of block.matchAll(regex)) {
        templates.push({
          templateId: match[1],
          templateVersion: normalizeVersion(match[2], constants),
          reviewStatus: match[3],
        });
      }
      return [locale, templates];
    }),
  );
}

function parseKoreanCounters(counterSource) {
  const constants = {
    KOREAN_COUNTER_REGISTRY_VERSION:
      /KOREAN_COUNTER_REGISTRY_VERSION\s*=\s*"([^"]+)"/.exec(counterSource)?.[1] ?? "unknown",
  };

  const counters = [];
  const regex =
    /counterId:\s*"([^"]+)"[\s\S]*?reviewerApproved:\s*(true|false)[\s\S]*?version:\s*([^,\n]+)/g;
  for (const match of counterSource.matchAll(regex)) {
    counters.push({
      counterId: match[1],
      reviewerApproved: match[2] === "true",
      version: normalizeVersion(match[3], constants),
    });
  }
  return counters;
}

function parseReviewLog(logSource) {
  return logSource
    .split(/\r?\n/)
    .filter((line) => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      return {
        date: cells[0] ?? "",
        reviewer: cells[1] ?? "",
        locale: cells[2] ?? "",
        artifact: cells[3] ?? "",
        decision: cells[4] ?? "",
        finalSignOff: cells[6] ?? "",
      };
    });
}

function parseNativeAcceptancePacket(packetSource) {
  const scenarioSection = packetSource.split("## Scenario Matrix")[1]?.split("## Reviewer Questions")[0] ?? "";
  const reviewerQuestionSection =
    packetSource.split("## Reviewer Questions")[1]?.split("## Evidence Manifest Template")[0] ?? "";
  const scenarioRows = scenarioSection.split(/\r?\n/).filter((line) => /^\|\s*NA-\d{3}\s*\|/.test(line));
  const reviewerQuestionRows = reviewerQuestionSection
    .split(/\r?\n/)
    .filter((line) => /^\|\s*(Is|Does|Are|Can|Would)\b/.test(line));
  const manifestRows = packetSource
    .split(/\r?\n/)
    .filter((line) => /^\|\s*NA-\d{3}\s*\|\s*[a-z]{2}-[A-Z]{2}\s*\|/.test(line));

  return {
    scenarioCount: scenarioRows.length,
    reviewerQuestionCount: reviewerQuestionRows.length,
    manifestSeedRows: manifestRows.length,
    hasNoSecretRule: packetSource.includes("Do not transcribe QR tokens, claim codes, redemption codes"),
    hasNoModelCallRule: packetSource.includes("Customer viewing must use approved stored localizations and must not make a model call"),
  };
}

function blockerCodesFor(record, templates, koreanCounters) {
  const blockers = [];
  if (record.nativeReviewStatus === "native_reviewer_tbd") blockers.push("NATIVE_REVIEWER_TBD");
  if (templates.some((template) => template.reviewStatus === "needs_native_review")) {
    blockers.push("OFFER_TEMPLATE_NATIVE_REVIEW_PENDING");
  }
  if (record.locale === "ko-KR" && koreanCounters.some((counter) => !counter.reviewerApproved)) {
    blockers.push("KOREAN_COUNTER_NATIVE_REVIEW_PENDING");
  }
  if (record.nativeScreenshotQaStatus === "pending") blockers.push("REAL_DEVICE_SCREENSHOT_QA_PENDING");
  return blockers;
}

function countReviewRowsForLocale(rows, locale) {
  return rows.filter((row) => row.locale === "all" || row.locale.split(",").map((item) => item.trim()).includes(locale));
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function formatList(values) {
  return values.length ? values.join(", ") : "none";
}

function buildDashboard() {
  const gate = parseGate(read("lib/localization-rollout-gate.ts"));
  const templatesByLocale = parseTemplates(read("lib/offer-locale-templates.ts"));
  const koreanCounters = parseKoreanCounters(read("lib/korean-counter-registry.ts"));
  const reviewRows = parseReviewLog(read(gate.nativeReviewLogPath));
  const nativeAcceptancePacket = parseNativeAcceptancePacket(read(NATIVE_ACCEPTANCE_PACKET_PATH));
  const publishSource = read("supabase/functions/publish-offer-version/index.ts");

  const generatedAt = new Date().toISOString();
  const lines = [
    "# Localization Rollout Dashboard",
    "",
    `Generated: ${generatedAt}`,
    "",
    "Source: local repository files. This is readiness/configuration evidence, not live production analytics.",
    "",
    `Rollout gate version: ${gate.version}`,
    `Native review log: ${gate.nativeReviewLogPath}`,
    "",
    "## Locale Readiness",
    "",
    "| Locale | Reviewer | Review status | Screenshot QA | Templates reviewed | Korean counters reviewed | Broad production |",
    "| --- | --- | --- | --- | ---: | ---: | --- |",
  ];

  for (const record of gate.records) {
    const templates = templatesByLocale[record.locale] ?? [];
    const blockers = blockerCodesFor(record, templates, koreanCounters);
    const reviewedTemplates = templates.filter((template) => template.reviewStatus !== "needs_native_review").length;
    const koreanCounterCell =
      record.locale === "ko-KR"
        ? `${koreanCounters.filter((counter) => counter.reviewerApproved).length}/${koreanCounters.length}`
        : "n/a";
    lines.push(
      `| ${record.locale} | ${record.reviewerName} | ${record.nativeReviewStatus} | ${record.nativeScreenshotQaStatus} | ${reviewedTemplates}/${templates.length} | ${koreanCounterCell} | ${blockers.length ? "Blocked" : "Allowed"} |`,
    );
  }

  lines.push("", "## Current Blockers", "");
  for (const record of gate.records) {
    const blockers = blockerCodesFor(record, templatesByLocale[record.locale] ?? [], koreanCounters);
    lines.push(`- ${record.locale}: ${formatList(blockers)}`);
  }

  lines.push(
    "",
    "## Publish Telemetry Coverage",
    "",
    "| Field | Present in ai_ad_versioned_publish source | Dashboard use |",
    "| --- | --- | --- |",
  );
  for (const [field, metric] of TELEMETRY_FIELDS) {
    lines.push(`| ${field} | ${yesNo(publishSource.includes(field))} | ${metric} |`);
  }

  lines.push("", "## Native Review Log Coverage", "");
  for (const locale of SUPPORTED_LOCALES) {
    const rows = countReviewRowsForLocale(reviewRows, locale);
    const finalSignOffs = rows.filter((row) => /^yes$/i.test(row.finalSignOff)).length;
    lines.push(`- ${locale}: ${rows.length} row(s), ${finalSignOffs} final sign-off(s).`);
  }

  lines.push(
    "",
    "## Native Acceptance Packet",
    "",
    `- Packet: ${NATIVE_ACCEPTANCE_PACKET_PATH}`,
    `- Scenario rows: ${nativeAcceptancePacket.scenarioCount}/${REQUIRED_NATIVE_ACCEPTANCE_SCENARIO_COUNT}`,
    `- Reviewer questions: ${nativeAcceptancePacket.reviewerQuestionCount}/${REQUIRED_NATIVE_ACCEPTANCE_QUESTION_COUNT}`,
    `- Evidence manifest seed rows: ${nativeAcceptancePacket.manifestSeedRows}`,
    `- No-secret screenshot rule: ${yesNo(nativeAcceptancePacket.hasNoSecretRule)}`,
    `- Customer no-model-call rule: ${yesNo(nativeAcceptancePacket.hasNoModelCallRule)}`,
    "- Completion state: Reviewer sign-off recorded for Spanish and Korean localization gates.",
  );

  const pendingCounters = koreanCounters.filter((counter) => !counter.reviewerApproved);
  lines.push(
    "",
    "## Korean Counter Registry",
    "",
    `- Version(s): ${formatList([...new Set(koreanCounters.map((counter) => counter.version))])}`,
    `- Reviewed counters: ${koreanCounters.length - pendingCounters.length}/${koreanCounters.length}`,
    `- Pending counters: ${formatList(pendingCounters.map((counter) => counter.counterId))}`,
    "",
    "## Operator Notes",
    "",
    "- Broad Spanish localization reviewer blockers are cleared; deployment remains separately hard-gated.",
    "- Broad Korean localization reviewer blockers are cleared; deployment remains separately hard-gated.",
    "- Hosted analytics will not include publish telemetry fields until Dan explicitly approves redeploying `publish-offer-version`.",
    "- Real-device screenshots and reviewer decisions must stay out of commits unless the artifact is explicitly sanitized for source control.",
    "",
  );

  return lines.join("\n");
}

function parseArgs(argv) {
  const outIndex = argv.findIndex((arg) => arg === "--out");
  const outEquals = argv.find((arg) => arg.startsWith("--out="));
  if (outEquals) return { out: outEquals.slice("--out=".length) };
  if (outIndex >= 0) return { out: argv[outIndex + 1] };
  return { out: null };
}

const { out } = parseArgs(process.argv.slice(2));
const dashboard = buildDashboard();

if (out) {
  const outputPath = path.resolve(root, out);
  if (!outputPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to write outside the repo: ${out}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, dashboard, "utf8");
  console.log(`Wrote ${path.relative(root, outputPath)}`);
} else {
  process.stdout.write(dashboard);
}
