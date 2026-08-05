#!/usr/bin/env node
/**
 * Naturalness evaluation for generated ad copy (naturalness plan Phase 4.2).
 *
 * Runs over a copy corpus produced by the corpus extractor
 * (qa-artifacts/ai-copy-baseline-2026-07-26/extract-copy-corpus.mjs shape):
 *   { rows: [{ created_at, model, copy_source, text: { generated: { headline, offer } } }] }
 *
 * Two passes:
 *  1. Deterministic (always runs, no key needed): the REAL production style gate
 *     (lib/ad-copy-style-gate.ts) plus the poster-shape predicates, so this report
 *     can never drift from what production enforces. Also flags offer-echo rows
 *     where the description restates the headline with no added angle.
 *  2. LLM-judged (only when OPENAI_API_KEY is set): scores soundsHuman /
 *     fitsBusiness / exchangeClear 1-10 per row. Skipped silently otherwise.
 *
 * On-demand tooling; deliberately NOT wired into CI. Never prints secrets.
 *
 * Usage:
 *   node scripts/evaluate-ad-copy-naturalness.mjs [corpusPath]
 *   OPENAI_API_KEY=... node scripts/evaluate-ad-copy-naturalness.mjs [corpusPath]
 *
 * Optional trending flags (naturalness plan Phase 4.2 follow-up; additive — a bare
 * invocation with none of these behaves byte-identically to the base script):
 *   --snapshot-dir <dir>   Also write dated report copies naturalness-YYYY-MM-DD.json/md
 *                          into <dir> (one pair per calendar day; reruns the same day
 *                          overwrite that day's pair).
 *   --compare-previous     Requires --snapshot-dir. Diffs this run's flag-class rates and
 *                          judge averages against the latest STRICTLY EARLIER dated
 *                          snapshot in that dir, prints the deltas, and exits nonzero if a
 *                          flag class both grew and is now over its calibration-watchlist
 *                          band (bands mirrored from scripts/measure-ai-ad-baseline.mjs;
 *                          see NATURALNESS_WATCHLIST_BANDS below for the mapping).
 *
 *   node scripts/evaluate-ad-copy-naturalness.mjs --snapshot-dir qa-artifacts/naturalness-trend
 *   node scripts/evaluate-ad-copy-naturalness.mjs --snapshot-dir qa-artifacts/naturalness-trend --compare-previous
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DISABLE_TYPELESS_WARNING = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
if (!process.execArgv.includes(DISABLE_TYPELESS_WARNING) && !process.env.TWOFER_NATURALNESS_REEXEC) {
  const { spawnSync } = await import("node:child_process");
  const child = spawnSync(process.execPath, [
    ...process.execArgv,
    DISABLE_TYPELESS_WARNING,
    fileURLToPath(import.meta.url),
    ...process.argv.slice(2),
  ], {
    cwd: process.cwd(),
    env: { ...process.env, TWOFER_NATURALNESS_REEXEC: "1" },
    stdio: "inherit",
  });
  process.exit(child.status ?? 1);
}

const {
  evaluateAdCopyStyleGate,
  endsInDanglingFunctionWord,
  hasQuantityArticleCollision,
  isFormulaicValueHeadline,
  startsWithDanglingConnector,
} = await import("../lib/ad-copy-style-gate.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Minimal flag parser for the optional trending flags. The first non-flag token is still
// the corpus path positional, exactly as before — a bare invocation (or one with just a
// corpus path) is parsed identically to the original `process.argv[2]` lookup.
const NATURALNESS_VALUE_FLAGS = new Set(["snapshot-dir"]);
const naturalnessCliArgs = process.argv.slice(2);
const naturalnessFlags = {};
let corpusPathArg;
for (let i = 0; i < naturalnessCliArgs.length; i += 1) {
  const a = naturalnessCliArgs[i];
  if (a.startsWith("--")) {
    const name = a.slice(2);
    if (NATURALNESS_VALUE_FLAGS.has(name) && naturalnessCliArgs[i + 1] !== undefined) {
      naturalnessFlags[name] = naturalnessCliArgs[i + 1];
      i += 1;
    } else {
      naturalnessFlags[name] = true;
    }
  } else if (corpusPathArg === undefined) {
    corpusPathArg = a;
  }
}
const snapshotDir = naturalnessFlags["snapshot-dir"]
  ? path.resolve(root, String(naturalnessFlags["snapshot-dir"]))
  : null;
const comparePrevious = Boolean(naturalnessFlags["compare-previous"]);

const corpusPath = path.resolve(
  root,
  corpusPathArg || "qa-artifacts/ai-copy-baseline-2026-07-26/copy-corpus.json",
);
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const rows = Array.isArray(corpus.rows) ? corpus.rows : [];

/** Same rounding poster/naturalness reports already use; returns a number, not a string. */
function avgOfScores(scoreRows, key) {
  if (!Array.isArray(scoreRows)) return null;
  const values = scoreRows.map((row) => Number(row[key])).filter(Number.isFinite);
  return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function tokens(value) {
  return new Set(
    cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9%\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1),
  );
}

function offerEcho(headline, description) {
  const headTokens = tokens(headline);
  const descTokens = tokens(description);
  if (headTokens.size === 0 || descTokens.size === 0) return false;
  let overlap = 0;
  for (const token of headTokens) if (descTokens.has(token)) overlap += 1;
  return overlap / headTokens.size >= 0.8;
}

function itemTermsOf(row) {
  const offer = row?.text?.structured_offer ?? {};
  return [
    offer?.single_item_discount?.item_name,
    offer?.required_purchase?.item_name,
    offer?.free_reward?.item_name,
  ].map(cleanText).filter(Boolean);
}

const evaluated = rows.map((row, index) => {
  const headline = cleanText(row?.text?.generated?.headline);
  const description = cleanText(row?.text?.generated?.offer);
  const flags = [];
  if (!headline && !description) {
    return { index, headline, description, copy_source: row.copy_source ?? null, flags: ["NO_COPY_IN_PAYLOAD"] };
  }
  const gate = evaluateAdCopyStyleGate({
    copy: { displayHook: headline || undefined, supportingLine: description || undefined },
    provenance: { displayHook: "ai_generated", supportingLine: "ai_generated" },
    requiredSpecificTerms: itemTermsOf(row),
  });
  for (const failure of gate.failures) {
    for (const reason of failure.reasons) flags.push(`${failure.field}:${reason}`);
  }
  if (headline && isFormulaicValueHeadline(headline)) flags.push("headline:FORMULAIC_VALUE");
  if (headline && startsWithDanglingConnector(headline)) flags.push("headline:DANGLING_CONNECTOR");
  if (headline && endsInDanglingFunctionWord(headline)) flags.push("headline:TRUNCATED_FRAGMENT");
  if (headline && hasQuantityArticleCollision(headline)) flags.push("headline:QUANTITY_ARTICLE_COLLISION");
  if (headline && description && offerEcho(headline, description)) flags.push("row:OFFER_ECHO");
  return {
    index,
    created_at: row.created_at ?? null,
    model: row.model ?? null,
    copy_source: row.copy_source ?? null,
    headline,
    description,
    flags: [...new Set(flags)],
  };
});

const flagCounts = {};
for (const row of evaluated) {
  for (const flag of row.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
}
const flaggedRows = evaluated.filter((row) => row.flags.length > 0);

// ---- Optional LLM pass -----------------------------------------------------
let llmSection = ["## LLM naturalness pass", "", "Skipped: OPENAI_API_KEY not set. Deterministic pass above still applies."];
let llmScores = null;
const apiKey = process.env.OPENAI_API_KEY || "";
if (apiKey) {
  const model = process.env.NATURALNESS_JUDGE_MODEL || "gpt-5.4-mini";
  const judgeRows = evaluated.filter((row) => row.headline || row.description).slice(0, 60);
  const schema = {
    name: "naturalness_scores",
    strict: true,
    schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number" },
              soundsHuman: { type: "number" },
              fitsBusiness: { type: "number" },
              exchangeClear: { type: "number" },
            },
            required: ["index", "soundsHuman", "fitsBusiness", "exchangeClear"],
            additionalProperties: false,
          },
        },
      },
      required: ["rows"],
      additionalProperties: false,
    },
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_completion_tokens: 6000,
      response_format: { type: "json_schema", json_schema: schema },
      messages: [
        {
          role: "system",
          content:
            "Score local-business ad copy. For each row, rate 1-10: soundsHuman (would a shop owner say this out loud to a regular?), fitsBusiness (does the angle fit this exact item/business, not a borrowed one?), exchangeClear (is what-you-do and what-you-get instantly clear?). Penalize template-sounding, machine-filled, or planning-vocabulary lines. Output JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify(judgeRows.map((row) => ({ index: row.index, headline: row.headline, description: row.description }))),
        },
      ],
    }),
  });
  if (res.ok) {
    const payload = await res.json();
    try {
      llmScores = JSON.parse(payload?.choices?.[0]?.message?.content ?? "{}")?.rows ?? null;
    } catch {
      llmScores = null;
    }
  }
  if (llmScores) {
    const avg = (key) => {
      const values = llmScores.map((row) => Number(row[key])).filter(Number.isFinite);
      return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : "n/a";
    };
    llmSection = [
      "## LLM naturalness pass",
      "",
      `Model: ${model}; rows scored: ${llmScores.length}.`,
      "",
      `- soundsHuman avg: ${avg("soundsHuman")}`,
      `- fitsBusiness avg: ${avg("fitsBusiness")}`,
      `- exchangeClear avg: ${avg("exchangeClear")}`,
    ];
  } else {
    llmSection = ["## LLM naturalness pass", "", `Attempted with ${model} but the response was unusable (HTTP ${res.status}). Deterministic pass above still applies.`];
  }
}

const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").slice(0, 80);
const md = [
  "# Ad copy naturalness report",
  "",
  `Corpus: ${path.relative(root, corpusPath)} (${rows.length} rows). Generated ${new Date().toISOString()}.`,
  "",
  "## Deterministic pass (production style gate + poster-shape predicates)",
  "",
  `Rows with at least one flag: ${flaggedRows.length}/${evaluated.length}.`,
  "",
  "| flag | count |",
  "|---|---:|",
  ...Object.entries(flagCounts).sort(([, a], [, b]) => b - a).map(([flag, count]) => `| ${flag} | ${count} |`),
  "",
  "### Flagged rows",
  "",
  "| when | source | headline | description | flags |",
  "|---|---|---|---|---|",
  ...flaggedRows.map((row) =>
    `| ${cell(row.created_at?.slice(0, 16))} | ${cell(row.copy_source)} | ${cell(row.headline)} | ${cell(row.description)} | ${cell(row.flags.join(", "))} |`,
  ),
  "",
  ...llmSection,
  "",
];

const outDir = path.dirname(corpusPath);
fs.writeFileSync(path.join(outDir, "naturalness-report.md"), md.join("\n"));
fs.writeFileSync(
  path.join(outDir, "naturalness-report.json"),
  JSON.stringify({ generated_at: new Date().toISOString(), corpus: path.relative(root, corpusPath), flag_counts: flagCounts, rows: evaluated, llm_scores: llmScores }, null, 2),
);
console.log(`naturalness: ${flaggedRows.length}/${evaluated.length} rows flagged; report written next to corpus`);
console.log(`top flags: ${Object.entries(flagCounts).sort(([, a], [, b]) => b - a).slice(0, 6).map(([flag, count]) => `${flag}=${count}`).join(", ") || "(none)"}`);

// ---- Optional snapshotting + trend comparison (naturalness trending follow-up) --------
// Everything below only runs when --snapshot-dir is passed, so a bare invocation's output
// and exit code are unchanged.
if (snapshotDir) {
  const dateTag = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshotJsonPath = path.join(snapshotDir, `naturalness-${dateTag}.json`);
  const snapshotMdPath = path.join(snapshotDir, `naturalness-${dateTag}.md`);
  const snapshotPayload = {
    generated_at: new Date().toISOString(),
    corpus: path.relative(root, corpusPath),
    row_count: evaluated.length,
    flagged_row_count: flaggedRows.length,
    flag_counts: flagCounts,
    llm_scores_present: Boolean(llmScores),
    llm_averages: llmScores
      ? {
          soundsHuman: avgOfScores(llmScores, "soundsHuman"),
          fitsBusiness: avgOfScores(llmScores, "fitsBusiness"),
          exchangeClear: avgOfScores(llmScores, "exchangeClear"),
        }
      : null,
  };
  fs.writeFileSync(snapshotJsonPath, JSON.stringify(snapshotPayload, null, 2));
  fs.writeFileSync(snapshotMdPath, md.join("\n"));
  console.log(`\nsnapshot written: ${snapshotJsonPath}`);

  if (comparePrevious) {
    // Calibration-watchlist bands mirrored from scripts/measure-ai-ad-baseline.mjs's
    // calibration_watchlist checks (that script needs a live Supabase service-role key and
    // cannot run in this tool, so the threshold VALUES are copied here, not imported). Of
    // that file's rate-shaped bands, two map onto "how often a quality problem shows up in
    // a text corpus":
    //   - deterministic_copy_fallback_rate, threshold 0.15 (measure-ai-ad-baseline.mjs,
    //     calibrationCheck around the "High fallback can mean prompt, validation, or
    //     provider reliability needs tuning" note) — mirrored as the ceiling for ordinary
    //     QA-heuristic flag classes (this script's own predicates: FORMULAIC_VALUE,
    //     DANGLING_CONNECTOR, TRUNCATED_FRAGMENT, QUANTITY_ARTICLE_COLLISION, OFFER_ECHO —
    //     all namespaced "headline:*" / "row:*" below, never a production field name).
    //   - judge_hard_failure_rate, threshold 0.2 ("Review failed candidate themes before
    //     changing prompts or judge criteria") — mirrored as the stricter ceiling for
    //     flags that ARE production hard-fail signals: NO_COPY_IN_PAYLOAD, and any flag
    //     whose field prefix is a real evaluateAdCopyStyleGate field (the REAL production
    //     style gate this script runs — see file header), i.e. displayHook/offerLine/
    //     supportingLine/cta/pushTitle/pushBody/socialCaption.
    // The two warning-only bands in that file (candidate_diversity_warning_thresholds,
    // image_aesthetic_thresholds) score images/candidate sets, not corpus rows, and are
    // intentionally not mirrored here.
    const NATURALNESS_WATCHLIST_BANDS = {
      hard_fail_flag_rate_ceiling: 0.2, // mirrors judge_hard_failure_rate
      general_flag_rate_ceiling: 0.15, // mirrors deterministic_copy_fallback_rate
    };
    const PRODUCTION_GATE_FIELDS = new Set([
      "displayHook",
      "offerLine",
      "supportingLine",
      "cta",
      "pushTitle",
      "pushBody",
      "socialCaption",
    ]);

    function findPreviousSnapshot(dir, currentJsonPath) {
      if (!fs.existsSync(dir)) return null;
      const files = fs
        .readdirSync(dir)
        .filter((f) => /^naturalness-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort(); // lexicographic sort == chronological for YYYY-MM-DD filenames
      const currentName = path.basename(currentJsonPath);
      const priorOnly = files.filter((f) => f < currentName);
      return priorOnly.length ? path.join(dir, priorOnly[priorOnly.length - 1]) : null;
    }

    const previousPath = findPreviousSnapshot(snapshotDir, snapshotJsonPath);
    if (!previousPath) {
      console.log("compare-previous: no earlier snapshot found in snapshot dir; skipping comparison.");
    } else {
      const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
      const prevTotal = Number(previous.row_count) || 0;
      const curTotal = evaluated.length || 0;
      const allFlagKeys = new Set([...Object.keys(flagCounts), ...Object.keys(previous.flag_counts || {})]);

      console.log(`\ncompare-previous: ${path.basename(previousPath)} -> ${path.basename(snapshotJsonPath)}`);
      let breached = false;
      for (const key of [...allFlagKeys].sort()) {
        const curCount = flagCounts[key] || 0;
        const prevCount = (previous.flag_counts || {})[key] || 0;
        const curRate = curTotal ? curCount / curTotal : 0;
        const prevRate = prevTotal ? prevCount / prevTotal : 0;
        const fieldPrefix = key.split(":")[0];
        const isHardFail = key === "NO_COPY_IN_PAYLOAD" || PRODUCTION_GATE_FIELDS.has(fieldPrefix);
        const ceiling = isHardFail
          ? NATURALNESS_WATCHLIST_BANDS.hard_fail_flag_rate_ceiling
          : NATURALNESS_WATCHLIST_BANDS.general_flag_rate_ceiling;
        const grew = curRate > prevRate;
        const overBand = curRate > ceiling;
        if (grew && overBand) breached = true;
        console.log(
          `  ${key.padEnd(46)} count ${prevCount}->${curCount}  rate ${prevRate.toFixed(3)}->${curRate.toFixed(3)}` +
            `  ceiling ${ceiling}${grew && overBand ? "  ** GREW BEYOND BAND **" : ""}`,
        );
      }
      if (previous.llm_averages || snapshotPayload.llm_averages) {
        console.log("  judge averages:");
        for (const key of ["soundsHuman", "fitsBusiness", "exchangeClear"]) {
          const prevVal = previous.llm_averages?.[key] ?? null;
          const curVal = snapshotPayload.llm_averages?.[key] ?? null;
          console.log(`    ${key}: ${prevVal ?? "n/a"} -> ${curVal ?? "n/a"}`);
        }
      }
      if (breached) {
        console.log("\ncompare-previous: FAIL - a flag class grew beyond its calibration-watchlist band.");
        process.exit(1);
      }
      console.log("\ncompare-previous: OK - no flag class grew beyond its calibration-watchlist band.");
    }
  }
}
