#!/usr/bin/env node
/**
 * Read-only baseline metrics for the AI ad generation master plan.
 *
 * Required env:
 * - SUPABASE_SERVICE_ROLE_KEY
 * - SUPABASE_URL, or EXPO_PUBLIC_SUPABASE_URL from the local environment
 *
 * Optional env:
 * - BASELINE_DAYS, default 30
 * - BASELINE_OUTPUT_JSON, path to write the JSON summary
 * - BASELINE_OUTPUT_MD, path to write a Markdown summary
 *
 * This script does not print secrets. It uses service-role REST reads because
 * ai_generation_logs / ai_generation_costs are private server-side ledgers.
 */

import fs from "node:fs";
import path from "node:path";

const HELP = `
Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/measure-ai-ad-baseline.mjs

Optional:
  BASELINE_DAYS=30
  BASELINE_OUTPUT_JSON=artifacts/ai-ad-baseline.json
  BASELINE_OUTPUT_MD=artifacts/ai-ad-baseline.md
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP.trim());
  process.exit(0);
}

const supabaseUrl = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const days = Number.parseInt(process.env.BASELINE_DAYS || "30", 10);
const baselineDays = Number.isFinite(days) && days > 0 ? days : 30;

const missing = [
  !supabaseUrl ? "SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL" : null,
  !serviceKey ? "SUPABASE_SERVICE_ROLE_KEY" : null,
].filter(Boolean);

if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  console.error(HELP.trim());
  process.exit(1);
}

const generatedAt = new Date();
const windowStart = new Date(generatedAt.getTime() - baselineDays * 24 * 60 * 60 * 1000);

function redactedErrorBody(value) {
  return String(value ?? "")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 800);
}

async function fetchPage(table, params, offset, limit) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${table} read failed: HTTP ${res.status} ${redactedErrorBody(text)}`);
  }
  return text ? JSON.parse(text) : [];
}

async function fetchAll(table, params) {
  const limit = 1000;
  const maxRows = 50_000;
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += limit) {
    const page = await fetchPage(table, params, offset, limit);
    rows.push(...page);
    if (page.length < limit) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function jsonPath(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function percentile(values, p) {
  const nums = values.map(numberOrNull).filter((value) => value !== null).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const index = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[index];
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(4));
}

function countBy(rows, pick) {
  const counts = {};
  for (const row of rows) {
    const key = pick(row) || "(missing)";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function latestValue(values) {
  return values.length > 0 ? values[values.length - 1] : null;
}

function dollars(value) {
  const n = Number(value || 0);
  return Number(n.toFixed(6));
}

function calibrationStatus(value, threshold, direction = "max") {
  const n = numberOrNull(value);
  if (n === null) return "needs_data";
  if (direction === "min") return n < threshold ? "review" : "ok";
  return n > threshold ? "review" : "ok";
}

function calibrationCheck({ metric, value, threshold, direction = "max", note }) {
  return {
    metric,
    value: numberOrNull(value),
    review_threshold: threshold,
    direction,
    status: calibrationStatus(value, threshold, direction),
    note,
  };
}

function attemptLatencySummary(attempts) {
  const latencies = attempts
    .map((attempt) => numberOrNull(attempt?.latency_ms ?? attempt?.latencyMs))
    .filter((value) => value !== null);
  return {
    sample_count: latencies.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
  };
}

const logParams = {
  select:
    "id,created_at,business_id,request_type,input_mode,prompt_version,model,success,failure_reason,quota_blocked,duplicate_blocked,estimated_cost_usd,response_payload,published_deal_id,openai_called,accepted_by_user",
  request_type: "in.(ad_variants,ad_refine)",
  created_at: `gte.${windowStart.toISOString()}`,
  order: "created_at.asc",
};

const costParams = {
  select:
    "created_at,business_id,deal_id,request_group_id,feature,provider,model,endpoint,input_tokens,cached_input_tokens,output_tokens,image_input_tokens,image_output_tokens,image_text_input_tokens,audio_seconds,web_search_calls,estimated_cost_usd,success,error_code",
  created_at: `gte.${windowStart.toISOString()}`,
  order: "created_at.asc",
};

const [{ rows: logs, truncated: logsTruncated }, { rows: costs, truncated: costsTruncated }] = await Promise.all([
  fetchAll("ai_generation_logs", logParams),
  fetchAll("ai_generation_costs", costParams),
]);

const logsWithCopy = logs.filter((row) => jsonPath(row.response_payload, ["copy"]));
const copyProviderAttempts = logsWithCopy.flatMap((row) =>
  arrayValue(jsonPath(row.response_payload, ["copy", "provider_attempts"])),
);
const copyProviderFallbackRows = logsWithCopy.filter(
  (row) => jsonPath(row.response_payload, ["copy", "provider_fallback_used"]) === true,
);
const copyQualityEntries = logsWithCopy.flatMap((row) =>
  arrayValue(jsonPath(row.response_payload, ["copy", "quality"])),
);
const latestCopyQualityEntries = logsWithCopy
  .map((row) => latestValue(arrayValue(jsonPath(row.response_payload, ["copy", "quality"]))))
  .filter(Boolean);
const judgeAttempts = logsWithCopy.flatMap((row) =>
  arrayValue(jsonPath(row.response_payload, ["copy", "judge", "attempts"])),
);
const copyLatencies = logs
  .map((row) => numberOrNull(jsonPath(row.response_payload, ["copy", "latency_ms"])))
  .filter((value) => value !== null);
const totalLatencies = logs
  .map((row) => numberOrNull(jsonPath(row.response_payload, ["total_latency_ms"])))
  .filter((value) => value !== null);
const fallbackLogs = logs.filter((row) => {
  const payload = row.response_payload || {};
  const events = Array.isArray(payload.events) ? payload.events : [];
  return (
    jsonPath(payload, ["copy", "source"]) === "DETERMINISTIC_FALLBACK" ||
    payload.deterministic_fallback_used === true ||
    events.includes("quick_deal_ai_fallback_used")
  );
});
const repairLogs = logs.filter((row) => Number(jsonPath(row.response_payload, ["repair_attempts"]) || 0) > 0);
const validationFailedLogs = logs.filter((row) => {
  const ids = jsonPath(row.response_payload, ["validation_rule_ids"]);
  return Array.isArray(ids) && ids.length > 0;
});
const imageFailureLogs = logs.filter((row) => {
  const source = jsonPath(row.response_payload, ["image_generation", "source"]);
  const produced = jsonPath(row.response_payload, ["image_generation", "produced_image"]);
  return source && produced === false;
});
const imageQaRows = logs.filter((row) => jsonPath(row.response_payload, ["image_qa"]));
const imageQaWarnings = imageQaRows.filter((row) => arrayValue(jsonPath(row.response_payload, ["image_qa", "warningCodes"])).length > 0);
const imageQaHardFails = imageQaRows.filter((row) =>
  arrayValue(jsonPath(row.response_payload, ["image_qa", "hardFailReasons"])).length > 0
);
const imageQaUnavailable = imageQaRows.filter((row) => jsonPath(row.response_payload, ["image_qa", "unavailable"]) === true);
const imageQaOverrideAllowed = imageQaRows.filter(
  (row) => jsonPath(row.response_payload, ["image_qa", "merchantOverrideAllowed"]) === true,
);
const imageQaOverrideAcknowledged = imageQaRows.filter(
  (row) => jsonPath(row.response_payload, ["image_qa", "merchantOverrideAcknowledged"]) === true,
);
const imageQaMissingItems = imageQaRows.filter((row) =>
  arrayValue(jsonPath(row.response_payload, ["image_qa", "missingItems"])).length > 0
);

const costByRequestGroup = new Map();
for (const row of costs) {
  const id = row.request_group_id || "(missing)";
  const current = costByRequestGroup.get(id) || {
    request_group_id: id,
    calls: 0,
    failed_calls: 0,
    total_ai_cost_usd: 0,
    first_created_at: row.created_at,
    last_created_at: row.created_at,
  };
  current.calls += 1;
  current.failed_calls += row.success === false ? 1 : 0;
  current.total_ai_cost_usd += Number(row.estimated_cost_usd || 0);
  current.first_created_at = current.first_created_at < row.created_at ? current.first_created_at : row.created_at;
  current.last_created_at = current.last_created_at > row.created_at ? current.last_created_at : row.created_at;
  costByRequestGroup.set(id, current);
}
const requestGroups = [...costByRequestGroup.values()].map((group) => ({
  ...group,
  total_ai_cost_usd: dollars(group.total_ai_cost_usd),
}));
const requestGroupCosts = requestGroups.map((group) => group.total_ai_cost_usd);
const totalCost = costs.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);
const failedCostCalls = costs.filter((row) => row.success === false).length;

const summary = {
  generated_at: generatedAt.toISOString(),
  window: {
    days: baselineDays,
    start_at: windowStart.toISOString(),
    end_at: generatedAt.toISOString(),
  },
  access: {
    mode: "service_role_rest_read",
    secrets_printed: false,
    logs_truncated: logsTruncated,
    costs_truncated: costsTruncated,
  },
  ai_ad_generation: {
    total_log_rows: logs.length,
    successful_log_rows: logs.filter((row) => row.success === true).length,
    failed_log_rows: logs.filter((row) => row.success === false).length,
    success_rate: rate(logs.filter((row) => row.success === true).length, logs.length),
    failure_rate: rate(logs.filter((row) => row.success === false).length, logs.length),
    quota_blocked_rows: logs.filter((row) => row.quota_blocked === true).length,
    duplicate_blocked_rows: logs.filter((row) => row.duplicate_blocked === true).length,
    by_request_type: countBy(logs, (row) => row.request_type),
    by_input_mode: countBy(logs, (row) => row.input_mode),
    by_model: countBy(logs, (row) => row.model),
  },
  copy_latency_ms: {
    sample_count: copyLatencies.length,
    p50: percentile(copyLatencies, 50),
    p95: percentile(copyLatencies, 95),
    min: copyLatencies.length ? Math.min(...copyLatencies) : null,
    max: copyLatencies.length ? Math.max(...copyLatencies) : null,
  },
  total_latency_ms: {
    sample_count: totalLatencies.length,
    p50: percentile(totalLatencies, 50),
    p95: percentile(totalLatencies, 95),
    min: totalLatencies.length ? Math.min(...totalLatencies) : null,
    max: totalLatencies.length ? Math.max(...totalLatencies) : null,
  },
  copy_quality: {
    rows_with_copy_payload: logsWithCopy.length,
    deterministic_fallback_rows: fallbackLogs.length,
    deterministic_fallback_rate: rate(fallbackLogs.length, logsWithCopy.length),
    repair_attempt_rows: repairLogs.length,
    repair_attempt_rate: rate(repairLogs.length, logsWithCopy.length),
    validation_failed_rows: validationFailedLogs.length,
    validation_failed_rate: rate(validationFailedLogs.length, logsWithCopy.length),
    copy_source_counts: countBy(logsWithCopy, (row) => jsonPath(row.response_payload, ["copy", "source"])),
    provider_fallback_rows: copyProviderFallbackRows.length,
    provider_fallback_rate: rate(copyProviderFallbackRows.length, logsWithCopy.length),
    provider_fallback_reasons: countBy(copyProviderFallbackRows, (row) =>
      jsonPath(row.response_payload, ["copy", "provider_fallback_reason"])
    ),
  },
  copy_provider_attempts: {
    total_attempt_rows: copyProviderAttempts.length,
    successful_attempt_rows: copyProviderAttempts.filter((attempt) => attempt?.success === true).length,
    failed_attempt_rows: copyProviderAttempts.filter((attempt) => attempt?.success === false).length,
    by_provider: countBy(copyProviderAttempts, (attempt) => attempt?.provider),
    by_model: countBy(copyProviderAttempts, (attempt) => attempt?.model),
    by_operation: countBy(copyProviderAttempts, (attempt) => attempt?.operation),
    by_error_class: countBy(
      copyProviderAttempts.filter((attempt) => attempt?.success === false),
      (attempt) => attempt?.error_class ?? attempt?.errorClass,
    ),
    latency_ms: attemptLatencySummary(copyProviderAttempts),
  },
  candidate_judge: {
    quality_entries: copyQualityEntries.length,
    latest_quality_entries: latestCopyQualityEntries.length,
    latest_used_rows: latestCopyQualityEntries.filter((entry) => jsonPath(entry, ["judge", "used"]) === true).length,
    latest_enabled_rows: latestCopyQualityEntries.filter((entry) => jsonPath(entry, ["judge", "enabled"]) === true).length,
    latest_pass_rows: latestCopyQualityEntries.filter((entry) => jsonPath(entry, ["judge", "pass"]) === true).length,
    latest_hard_failure_rows: latestCopyQualityEntries.filter(
      (entry) => arrayValue(jsonPath(entry, ["judge", "hard_failures"])).length > 0,
    ).length,
    skipped_reasons: countBy(copyQualityEntries, (entry) => jsonPath(entry, ["judge", "skipped_reason"])),
    provider_counts: countBy(latestCopyQualityEntries, (entry) => jsonPath(entry, ["judge", "provider"])),
    model_counts: countBy(latestCopyQualityEntries, (entry) => jsonPath(entry, ["judge", "model"])),
    attempt_rows: judgeAttempts.length,
    successful_attempt_rows: judgeAttempts.filter((attempt) => attempt?.success === true).length,
    failed_attempt_rows: judgeAttempts.filter((attempt) => attempt?.success === false).length,
    attempt_error_classes: countBy(
      judgeAttempts.filter((attempt) => attempt?.success === false),
      (attempt) => attempt?.error_class ?? attempt?.errorClass,
    ),
    attempt_latency_ms: attemptLatencySummary(judgeAttempts),
  },
  image_generation: {
    source_counts: countBy(logs, (row) => jsonPath(row.response_payload, ["image_generation", "source"])),
    provider_counts: countBy(logs, (row) => jsonPath(row.response_payload, ["image_generation", "provider"])),
    model_counts: countBy(logs, (row) => jsonPath(row.response_payload, ["image_generation", "model"])),
    selection_source_mode_counts: countBy(logs, (row) => jsonPath(row.response_payload, ["image_selection", "sourceMode"])),
    selection_edit_mode_counts: countBy(logs, (row) => jsonPath(row.response_payload, ["image_selection", "editMode"])),
    failed_image_rows: imageFailureLogs.length,
    failed_image_rate: rate(imageFailureLogs.length, logsWithCopy.length),
  },
  image_qa: {
    rows_with_image_qa: imageQaRows.length,
    checked_rows: imageQaRows.filter((row) => jsonPath(row.response_payload, ["image_qa", "checked"]) === true).length,
    unavailable_rows: imageQaUnavailable.length,
    unavailable_rate: rate(imageQaUnavailable.length, imageQaRows.length),
    hard_fail_rows: imageQaHardFails.length,
    warning_rows: imageQaWarnings.length,
    missing_required_item_rows: imageQaMissingItems.length,
    override_allowed_rows: imageQaOverrideAllowed.length,
    override_acknowledged_rows: imageQaOverrideAcknowledged.length,
    override_acknowledgement_rate: rate(imageQaOverrideAcknowledged.length, imageQaOverrideAllowed.length),
    decision_counts: countBy(imageQaRows, (row) => jsonPath(row.response_payload, ["image_qa", "decision"])),
    source_type_counts: countBy(imageQaRows, (row) => jsonPath(row.response_payload, ["image_qa", "sourceType"])),
    warning_code_counts: countBy(
      imageQaRows.flatMap((row) => arrayValue(jsonPath(row.response_payload, ["image_qa", "warningCodes"]))),
      (value) => value,
    ),
    hard_fail_reason_counts: countBy(
      imageQaRows.flatMap((row) => arrayValue(jsonPath(row.response_payload, ["image_qa", "hardFailReasons"]))),
      (value) => value,
    ),
  },
  ai_costs: {
    provider_call_rows: costs.length,
    failed_or_retried_call_rows: failedCostCalls,
    failed_or_retried_call_rate: rate(failedCostCalls, costs.length),
    distinct_request_groups: requestGroups.length,
    total_ai_cost_usd: dollars(totalCost),
    average_cost_per_request_group_usd: requestGroups.length ? dollars(totalCost / requestGroups.length) : null,
    p50_cost_per_request_group_usd: percentile(requestGroupCosts, 50),
    p95_cost_per_request_group_usd: percentile(requestGroupCosts, 95),
    total_web_search_calls: costs.reduce((sum, row) => sum + Number(row.web_search_calls || 0), 0),
    image_provider_call_rows: costs.filter((row) => String(row.endpoint || "").startsWith("images.")).length,
    by_feature: countBy(costs, (row) => row.feature),
    by_endpoint: countBy(costs, (row) => row.endpoint),
    by_model: countBy(costs, (row) => row.model),
  },
  known_gaps: [
    "ai_generation_logs does not store request_group_id, so cost rows and generation log rows are aggregated separately.",
    "Publish conversion and no-edit publish rate cannot be computed reliably until generation/ad ids are written to deals or publish_events.",
  ],
};

const judgeHardFailureRate = rate(
  summary.candidate_judge.latest_hard_failure_rows,
  summary.candidate_judge.latest_quality_entries,
);
const imageQaHardFailRate = rate(summary.image_qa.hard_fail_rows, summary.image_qa.rows_with_image_qa);

summary.calibration_watchlist = {
  source: "baseline_runner_default_review_bands",
  warning_mode_only: true,
  note:
    "These review bands are internal dashboard defaults, not automatic product gates. Calibrate them from real non-publishing output before enabling or tightening production controls.",
  checks: [
    calibrationCheck({
      metric: "copy_latency_p95_ms",
      value: summary.copy_latency_ms.p95,
      threshold: 14_000,
      note: "Compare against merchant wait tolerance and provider timeout settings.",
    }),
    calibrationCheck({
      metric: "total_generation_latency_p95_ms",
      value: summary.total_latency_ms.p95,
      threshold: 45_000,
      note: "Review full start-to-preview wait time across research, copy, image generation, and QA.",
    }),
    calibrationCheck({
      metric: "deterministic_copy_fallback_rate",
      value: summary.copy_quality.deterministic_fallback_rate,
      threshold: 0.15,
      note: "High fallback can mean prompt, validation, or provider reliability needs tuning.",
    }),
    calibrationCheck({
      metric: "provider_fallback_rate",
      value: summary.copy_quality.provider_fallback_rate,
      threshold: 0.25,
      note: "High OpenAI-to-Gemini fallback can indicate quota, circuit, timeout, or configuration trouble.",
    }),
    calibrationCheck({
      metric: "judge_hard_failure_rate",
      value: judgeHardFailureRate,
      threshold: 0.2,
      note: "Review failed candidate themes before changing prompts or judge criteria.",
    }),
    calibrationCheck({
      metric: "image_qa_unavailable_rate",
      value: summary.image_qa.unavailable_rate,
      threshold: 0.05,
      note: "Generated and AI-edited images should stay closed when QA is unavailable.",
    }),
    calibrationCheck({
      metric: "image_qa_hard_fail_rate",
      value: imageQaHardFailRate,
      threshold: 0.1,
      note: "Investigate repeated missing-item, misleading-offer, identity, text, or QR failures.",
    }),
    calibrationCheck({
      metric: "failed_or_retried_provider_call_rate",
      value: summary.ai_costs.failed_or_retried_call_rate,
      threshold: 0.15,
      note: "Includes failed provider calls and retries recorded in the cost ledger.",
    }),
    calibrationCheck({
      metric: "p95_cost_per_request_group_usd",
      value: summary.ai_costs.p95_cost_per_request_group_usd,
      threshold: 0.5,
      note: "Default hard budget guard is 0.50 USD unless hosted env overrides it.",
    }),
    {
      metric: "candidate_diversity_warning_thresholds",
      value: "headline_jaccard>=0.65, body_jaccard>=0.75",
      review_threshold: "warning_only",
      direction: "n/a",
      status: "warning_only_calibration",
      note: "Do not hard-reject solely on these warning thresholds during the first release.",
    },
    {
      metric: "image_aesthetic_thresholds",
      value: "warning_mode",
      review_threshold: "product_decision_required_before_blocking",
      direction: "n/a",
      status: "warning_only_calibration",
      note: "Never turn an aesthetic warning on an unmodified merchant upload into a hard block without a separate product decision.",
    },
  ],
  next_steps: [
    "Run representative non-publishing generations with final hosted config.",
    "Review dashboard rows with Dan before tightening warning thresholds.",
    "Record failures and improve merchant context, prompts, creative briefs, or thresholds before enabling the next slice.",
  ],
};

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function formatCounts(counts) {
  const entries = Object.entries(counts || {});
  if (entries.length === 0) return "- none";
  return entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function formatCalibrationValue(value) {
  if (value === null || value === undefined) return "n/a";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  return String(value).replace(/\|/g, "/");
}

function formatCalibrationChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return "- none";
  const rows = checks.map((check) =>
    `| ${formatCalibrationValue(check.metric)} | ${formatCalibrationValue(check.value)} | ${formatCalibrationValue(
      check.review_threshold,
    )} | ${formatCalibrationValue(check.status)} | ${formatCalibrationValue(check.note)} |`,
  );
  return [
    "| Metric | Value | Review threshold | Status | Note |",
    "|---|---:|---:|---|---|",
    ...rows,
  ].join("\n");
}

function toMarkdown(data) {
  return `# AI Ad Baseline Metrics

Generated: ${data.generated_at}
Window: ${data.window.start_at} to ${data.window.end_at} (${data.window.days} days)

## Generation

- Total ad log rows: ${data.ai_ad_generation.total_log_rows}
- Success rate: ${data.ai_ad_generation.success_rate ?? "n/a"}
- Failure rate: ${data.ai_ad_generation.failure_rate ?? "n/a"}
- Total latency p50 / p95: ${data.total_latency_ms.p50 ?? "n/a"} ms / ${data.total_latency_ms.p95 ?? "n/a"} ms
- Copy latency p50 / p95: ${data.copy_latency_ms.p50 ?? "n/a"} ms / ${data.copy_latency_ms.p95 ?? "n/a"} ms
- Deterministic fallback rate: ${data.copy_quality.deterministic_fallback_rate ?? "n/a"}
- Provider fallback rate: ${data.copy_quality.provider_fallback_rate ?? "n/a"}
- Image failure rate: ${data.image_generation.failed_image_rate ?? "n/a"}

## Calibration Watchlist

${data.calibration_watchlist?.note ?? "Review bands unavailable."}

${formatCalibrationChecks(data.calibration_watchlist?.checks)}

Next steps:

${(data.calibration_watchlist?.next_steps ?? []).map((step) => `- ${step}`).join("\n") || "- none"}

### Copy Provider Attempts

- Attempt rows: ${data.copy_provider_attempts.total_attempt_rows}
- Successful / failed attempts: ${data.copy_provider_attempts.successful_attempt_rows} / ${data.copy_provider_attempts.failed_attempt_rows}
- Attempt latency p50 / p95: ${data.copy_provider_attempts.latency_ms.p50 ?? "n/a"} ms / ${data.copy_provider_attempts.latency_ms.p95 ?? "n/a"} ms

Provider fallback reasons:

${formatCounts(data.copy_quality.provider_fallback_reasons)}

Copy providers:

${formatCounts(data.copy_provider_attempts.by_provider)}

### Candidate Judge

- Latest quality entries: ${data.candidate_judge.latest_quality_entries}
- Judge enabled / used rows: ${data.candidate_judge.latest_enabled_rows} / ${data.candidate_judge.latest_used_rows}
- Judge pass rows: ${data.candidate_judge.latest_pass_rows}
- Judge hard-failure rows: ${data.candidate_judge.latest_hard_failure_rows}
- Judge attempt rows: ${data.candidate_judge.attempt_rows}
- Judge attempt latency p50 / p95: ${data.candidate_judge.attempt_latency_ms.p50 ?? "n/a"} ms / ${data.candidate_judge.attempt_latency_ms.p95 ?? "n/a"} ms

Judge skipped reasons:

${formatCounts(data.candidate_judge.skipped_reasons)}

## Cost

- Provider call rows: ${data.ai_costs.provider_call_rows}
- Distinct request groups: ${data.ai_costs.distinct_request_groups}
- Total AI cost: $${data.ai_costs.total_ai_cost_usd}
- Average cost per request group: ${
    data.ai_costs.average_cost_per_request_group_usd === null
      ? "n/a"
      : `$${data.ai_costs.average_cost_per_request_group_usd}`
  }
- Cost per request group p50 / p95: ${
    data.ai_costs.p50_cost_per_request_group_usd === null ? "n/a" : `$${data.ai_costs.p50_cost_per_request_group_usd}`
  } / ${
    data.ai_costs.p95_cost_per_request_group_usd === null ? "n/a" : `$${data.ai_costs.p95_cost_per_request_group_usd}`
  }
- Failed/retried provider call rate: ${data.ai_costs.failed_or_retried_call_rate ?? "n/a"}

## Image QA

- Rows with image QA: ${data.image_qa.rows_with_image_qa}
- Checked rows: ${data.image_qa.checked_rows}
- Unavailable rows / rate: ${data.image_qa.unavailable_rows} / ${data.image_qa.unavailable_rate ?? "n/a"}
- Hard-fail rows: ${data.image_qa.hard_fail_rows}
- Warning rows: ${data.image_qa.warning_rows}
- Missing required item rows: ${data.image_qa.missing_required_item_rows}
- Merchant override allowed / acknowledged: ${data.image_qa.override_allowed_rows} / ${data.image_qa.override_acknowledged_rows}
- Merchant override acknowledgement rate: ${data.image_qa.override_acknowledgement_rate ?? "n/a"}

Image QA decisions:

${formatCounts(data.image_qa.decision_counts)}

Image source modes:

${formatCounts(data.image_generation.selection_source_mode_counts)}

Image edit modes:

${formatCounts(data.image_generation.selection_edit_mode_counts)}

## Known Gaps

${data.known_gaps.map((gap) => `- ${gap}`).join("\n")}
`;
}

const json = `${JSON.stringify(summary, null, 2)}\n`;
if (process.env.BASELINE_OUTPUT_JSON) {
  ensureParent(process.env.BASELINE_OUTPUT_JSON);
  fs.writeFileSync(process.env.BASELINE_OUTPUT_JSON, json);
}
if (process.env.BASELINE_OUTPUT_MD) {
  ensureParent(process.env.BASELINE_OUTPUT_MD);
  fs.writeFileSync(process.env.BASELINE_OUTPUT_MD, toMarkdown(summary));
}

console.log(json);
