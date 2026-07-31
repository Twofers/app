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
const corpusPath = path.resolve(
  root,
  process.argv[2] || "qa-artifacts/ai-copy-baseline-2026-07-26/copy-corpus.json",
);
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const rows = Array.isArray(corpus.rows) ? corpus.rows : [];

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
