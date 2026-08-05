#!/usr/bin/env node
// [aiqa] poster-quality — LLM vision judge for poster render screenshots.
//
// Scores a directory of poster images (device screenshots, dev-gallery renders, or raw
// generated backgrounds composited by hand) against the §7 rubric from
// artifacts/poster-quality/2026-07-20-run2/ANCHORS.md (read-only source; embedded below as
// RUBRIC, with the file's provenance noted). On-demand tooling; NOT wired into CI, same as
// scripts/evaluate-ad-copy-naturalness.mjs, whose strict-json_schema judge pattern this
// script follows (OPENAI_API_KEY required, chat.completions + response_format
// json_schema/strict, one call per batch of images).
//
// Every dimension in the rubric is scored 1-5 with a one-line rationale, plus a boolean
// per hard-fail category (any true = the cell fails regardless of dimension scores, per
// ANCHORS.md's "Hard fails" section). This script does not enforce a pass bar itself — it
// reports; a human (or a future gate script) decides what to do with the numbers.
//
// Usage:
//   OPENAI_API_KEY=... node scripts/qa/poster-vision-judge.mjs --dir path/to/screenshots
//   OPENAI_API_KEY=... node scripts/qa/poster-vision-judge.mjs --dir <dir> --metadata facts.json
//   OPENAI_API_KEY=... node scripts/qa/poster-vision-judge.mjs --dir <dir> --batch-size 3 --report-dir out/
//   POSTER_VISION_JUDGE_MODEL=gpt-5.4-mini OPENAI_API_KEY=... node scripts/qa/poster-vision-judge.mjs --dir <dir>
//
// --metadata <file.json> is optional per-image offer-fact context for the fact_drift hard
// fail. Shape: either { "<basename>": { ...facts }, ... } or [{ "file": "<basename>",
// ...facts }, ...]. Images without a matching entry are judged with no fact context (the
// judge is told this explicitly, and fact_drift for that image should be treated as
// unverified rather than trusted).
import fs from "node:fs";
import path from "node:path";

const VALUE_FLAGS = new Set(["dir", "metadata", "report-dir", "batch-size", "model"]);
const rawArgs = process.argv.slice(2);
const args = {};
for (let i = 0; i < rawArgs.length; i += 1) {
  const a = rawArgs[i];
  if (a.startsWith("--")) {
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name) && rawArgs[i + 1] !== undefined && !rawArgs[i + 1].startsWith("--")) {
      args[name] = rawArgs[i + 1];
      i += 1;
    } else {
      args[name] = true;
    }
  }
}

if (!args.dir) {
  console.log(
    "usage: OPENAI_API_KEY=... node scripts/qa/poster-vision-judge.mjs --dir <images-dir>\n" +
      "                 [--metadata <facts.json>] [--batch-size 4] [--report-dir <dir>] [--model <name>]",
  );
  process.exit(1);
}

const apiKey = process.env.OPENAI_API_KEY || "";
if (!apiKey) {
  console.error("OPENAI_API_KEY is required (this script has no deterministic fallback pass — it IS the judge).");
  process.exit(1);
}

const model = args.model || process.env.POSTER_VISION_JUDGE_MODEL || "gpt-5.4-mini";
const batchSize = Math.max(1, Number(args["batch-size"]) || 4);

// ---------------------------------------------------------------------------
// Rubric — embedded from artifacts/poster-quality/2026-07-20-run2/ANCHORS.md ("Scoring
// anchors — poster ad quality rubric (§7)"), which is a gitignored local artifact this
// repo's tooling promotes durable copies of. Scale and pass-bar language, the 7 numbered
// dimensions' 1/3/5 anchors, and the "Hard fails" list are reproduced (lightly condensed
// for prompt-brevity) directly from that file's headings and anchor rows. If that file is
// ever absent, docs/plans/poster-ad-quality-harness.md is the fallback source (it defines
// the same harness this rubric scores).
// ---------------------------------------------------------------------------
const RUBRIC = {
  scale: "1 = would embarrass the merchant. 3 = acceptable but visibly amateur. 5 = a marketing team would ship this.",
  pass_bar: "corpus mean >=4.2, no dimension mean <3.5, no cell <3, zero hard fails (informational only — this script does not enforce it).",
  hard_fails: [
    { key: "fact_drift", label: "Fact drift — poster contradicts the locked offer facts" },
    { key: "baked_in_text_qr_logo", label: "Baked-in text / QR / logo in image pixels" },
    { key: "wrong_subject_or_ai_slop", label: "Wrong subject or AI-slop artifacts (extra fingers, melted objects, nonsense signage)" },
    { key: "mechanical_contrast_fail", label: "Mechanical contrast <3:1 on large text, or text unreadable in situ" },
    { key: "truncation_overflow_collision", label: "Truncation, overflow, or element collision" },
    { key: "preview_publish_mismatch", label: "Preview != publish, or a nondeterministic render" },
    { key: "ko_es_tofu_or_fallback_font", label: "KO/ES tofu or silent fallback fonts" },
    { key: "no_image_dead_end", label: "No-image dead end" },
  ],
  dimensions: [
    {
      key: "stopping_power",
      title: "1. Stopping power — does it halt a thumb mid-scroll?",
      anchor_1: "Nothing draws the eye; headline disappears into the photo; no focal contrast anywhere.",
      anchor_3: "Readable and inoffensive, but generic — could be any business. Offer value not instantly obvious at feed size.",
      anchor_5: "Bold, high stopping power; the offer reads as a deal at a glance (e.g. a dark-on-gold offer badge far more legible than plain colored text).",
      note: "Deduct for wasted canvas — letterbox bands shrink the visual payload even when text is legible.",
    },
    {
      key: "image_craft",
      title: "2. Image craft — is this a photo a real brand would buy?",
      anchor_1: "Wrong subject, visible AI artifacts, or muddy/unusable lighting.",
      anchor_3: "Appetizing subject but a compositional flaw that costs production value (e.g. letterboxed: flat bands top+bottom, photo only in the middle band — reads as 'photo with bars', not full-bleed).",
      anchor_5: "Full-bleed, magazine-quality; subject sharp, background soft-focus, warm coherent light.",
      note: "Multi-item cells must show correct subject coherence — distinct items for a multi-reward deal, not one item duplicated.",
    },
    {
      key: "typographic_hierarchy",
      title: "3. Typographic hierarchy — does the eye land in the right order?",
      anchor_1: "Flat — headline, offer, and business name compete; nothing dominates. Or the display font silently fell back (also a hard fail).",
      anchor_3: "Correct order but weak contrast between levels; the offer does not out-rank the business name.",
      anchor_5: "Headline -> offer -> supporting -> business reads in one pass; size and weight visibly separate the levels.",
      note: "Explicit ceiling rule: size alone is not hierarchy. If contrast between levels fails, hierarchy cannot score above 2.",
    },
    {
      key: "legibility_everywhere",
      title: "4. Legibility everywhere — readable on every background, not by luck",
      anchor_1: "Text nearly invisible against its background (e.g. dark ink on a dark subject, ~1:1-1.5:1 contrast). Only accent-colored text survives.",
      anchor_3: "Legible only because of this particular background (e.g. it happens to sit on a light band). Score cannot exceed 3 if legibility depends on background luck rather than a spec that holds up generally.",
      anchor_5: "Validated across the luminance range — legible on both a dark and a light background, not just this one.",
      note: "Mechanical contrast is a gate (measure separately with scripts/qa/poster-contrast-check.mjs or poster-contrast-sweep.mjs), not this dimension's score by itself — this dimension is the human/visual read.",
    },
    {
      key: "color_harmony",
      title: "5. Color harmony — do template colors belong on this photo?",
      anchor_1: "Palette actively clashes, or the colors look tuned for a different (e.g. flat gradient) background, not this scrimmed photo.",
      anchor_3: "Neutral and safe; ink survives but nothing is tuned to the image.",
      anchor_5: "Ink and accent feel chosen for the photo — light ink on a photo, warm accent kept, nothing fights the image.",
    },
    {
      key: "copy_craft",
      title: "6. Copy craft — does the headline earn the read?",
      anchor_1: "Contradicts or muddies the offer; generic filler; or an ungrammatical stub/fragment.",
      anchor_3: "Accurate and clear but flat — restates the mechanic with no hook.",
      anchor_5: "States the customer action and the reward naturally, with a hook suited to the merchant's voice; the kicker adds information rather than echoing the headline.",
      note: "Facts are authoritative — creativity may never alter them. Judge copy craft only from what is visible in the image; do not assume facts not shown.",
    },
    {
      key: "layout_balance",
      title: "7. Layout & balance — does the frame feel composed?",
      anchor_1: "Collision, overflow, or text stranded on a busy region; margins visibly uneven.",
      anchor_3: "Safe and symmetrical but inert — text parked in a dead zone with no relationship to the subject.",
      anchor_5: "Overlay sits in genuinely calm image regions, subject stays unobstructed, margins consistent, offer block optically balanced against the headline.",
    },
  ],
};

function rubricPromptText() {
  const lines = [];
  lines.push(`Scale: ${RUBRIC.scale}`);
  lines.push(`Pass bar (context only, do not self-enforce): ${RUBRIC.pass_bar}`);
  lines.push("");
  lines.push("Hard fail categories (booleans; ANY true means the cell fails regardless of dimension scores):");
  for (const hf of RUBRIC.hard_fails) lines.push(`- ${hf.key}: ${hf.label}`);
  lines.push("");
  lines.push("Score each of these 7 dimensions 1-5 (half-points allowed) with a one-line rationale:");
  for (const dim of RUBRIC.dimensions) {
    lines.push(`\n${dim.title}`);
    lines.push(`  1: ${dim.anchor_1}`);
    lines.push(`  3: ${dim.anchor_3}`);
    lines.push(`  5: ${dim.anchor_5}`);
    if (dim.note) lines.push(`  note: ${dim.note}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
function listImages(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listImages(full));
    else if (entry.isFile() && IMAGE_EXT_RE.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const dir = String(args.dir);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`not a directory: ${dir}`);
  process.exit(1);
}
const imageFiles = listImages(dir);
if (imageFiles.length === 0) {
  console.error(`no .png/.jpg/.jpeg/.webp files found under ${dir}`);
  process.exit(1);
}

let metadataByFile = {};
if (args.metadata) {
  const raw = JSON.parse(fs.readFileSync(String(args.metadata), "utf8"));
  if (Array.isArray(raw)) {
    for (const entry of raw) if (entry && entry.file) metadataByFile[path.basename(entry.file)] = entry;
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) metadataByFile[path.basename(key)] = value;
  }
}

const MIME_BY_EXT = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
function toDataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";
  const b64 = fs.readFileSync(file).toString("base64");
  return `data:${mime};base64,${b64}`;
}

// ---------------------------------------------------------------------------
// Strict json_schema judge call (pattern from scripts/evaluate-ad-copy-naturalness.mjs's
// LLM naturalness pass: response_format json_schema/strict, OPENAI_API_KEY, chat.completions).
// ---------------------------------------------------------------------------

const DIMENSION_KEYS = RUBRIC.dimensions.map((d) => d.key);
const HARD_FAIL_KEYS = RUBRIC.hard_fails.map((h) => h.key);

const dimensionScoreSchema = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 1, maximum: 5 },
    rationale: { type: "string" },
  },
  required: ["score", "rationale"],
  additionalProperties: false,
};

const judgmentSchema = {
  name: "poster_vision_judgment",
  strict: true,
  schema: {
    type: "object",
    properties: {
      images: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number" },
            file: { type: "string" },
            dimensions: {
              type: "object",
              properties: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, dimensionScoreSchema])),
              required: DIMENSION_KEYS,
              additionalProperties: false,
            },
            hard_fails: {
              type: "object",
              properties: Object.fromEntries(HARD_FAIL_KEYS.map((k) => [k, { type: "boolean" }])),
              required: HARD_FAIL_KEYS,
              additionalProperties: false,
            },
            overall_rationale: { type: "string" },
          },
          required: ["index", "file", "dimensions", "hard_fails", "overall_rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["images"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT =
  "You are a mechanical, literal ad-quality judge for local-business poster ads. Score only what is " +
  "visible in each image. Do not be generous — the anchors define the scale, use them. A hard fail is " +
  "true whenever its condition is visibly met, regardless of how good the dimension scores look. Output " +
  "JSON only, one entry per input image, in the same order the images were given, indexed from 0.";

function batches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function judgeBatch(files, startIndex) {
  const content = [
    {
      type: "text",
      text:
        `${rubricPromptText()}\n\nJudge the following ${files.length} poster image(s), indexed ${startIndex}..${
          startIndex + files.length - 1
        } in this order. For each, "file" must be the exact basename given below.\n\n` +
        files
          .map((f, i) => {
            const meta = metadataByFile[path.basename(f)];
            const factLine = meta
              ? `offer facts for fact_drift check: ${JSON.stringify(meta)}`
              : "no offer-fact metadata provided for this image — treat fact_drift as unverifiable rather than assuming it passed.";
            return `Image ${startIndex + i} = "${path.basename(f)}". ${factLine}`;
          })
          .join("\n"),
    },
    ...files.map((f) => ({ type: "image_url", image_url: { url: toDataUri(f) } })),
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_completion_tokens: 4000 * files.length + 2000,
      response_format: { type: "json_schema", json_schema: judgmentSchema },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: bodyText.slice(0, 500) };
  }
  const payload = await res.json();
  try {
    const parsed = JSON.parse(payload?.choices?.[0]?.message?.content ?? "{}");
    return { ok: true, images: Array.isArray(parsed.images) ? parsed.images : [] };
  } catch (e) {
    return { ok: false, status: res.status, error: `unparseable judge response: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`poster-vision-judge: ${imageFiles.length} image(s), model=${model}, batch-size=${batchSize}`);
const chunked = batches(imageFiles, batchSize);
const allResults = [];
const errors = [];
let cursor = 0;
for (const chunk of chunked) {
  process.stdout.write(`  judging ${chunk.length} image(s) starting at index ${cursor} … `);
  const res = await judgeBatch(chunk, cursor);
  if (!res.ok) {
    console.log(`FAILED (HTTP ${res.status ?? "n/a"})`);
    errors.push({ files: chunk.map((f) => path.basename(f)), error: res.error });
  } else {
    console.log(`ok (${res.images.length} judged)`);
    for (const img of res.images) allResults.push({ ...img, source_path: chunk[img.index - cursor] ?? null });
  }
  cursor += chunk.length;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const reportDir = String(args["report-dir"] || path.join(dir, "vision-judge-report"));
fs.mkdirSync(reportDir, { recursive: true });

function dimensionMean(key) {
  const values = allResults.map((r) => Number(r?.dimensions?.[key]?.score)).filter(Number.isFinite);
  return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
}
const dimensionMeans = Object.fromEntries(DIMENSION_KEYS.map((k) => [k, dimensionMean(k)]));
const overallMean = (() => {
  const vals = Object.values(dimensionMeans).filter((v) => v !== null);
  return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
})();
const hardFailCounts = Object.fromEntries(
  HARD_FAIL_KEYS.map((k) => [k, allResults.filter((r) => r?.hard_fails?.[k] === true).length]),
);
const cellsWithHardFail = allResults.filter((r) => HARD_FAIL_KEYS.some((k) => r?.hard_fails?.[k] === true)).length;

const jsonReport = {
  generated_at: new Date().toISOString(),
  model,
  source_dir: dir,
  image_count: imageFiles.length,
  judged_count: allResults.length,
  errors,
  dimension_means: dimensionMeans,
  overall_mean: overallMean,
  hard_fail_counts: hardFailCounts,
  cells_with_any_hard_fail: cellsWithHardFail,
  results: allResults,
};
fs.writeFileSync(path.join(reportDir, "vision-judge-report.json"), JSON.stringify(jsonReport, null, 2));

const cell = (v) => String(v ?? "").replace(/\|/g, "\\|").slice(0, 100);
const md = [
  "# Poster vision judge report",
  "",
  `Generated ${jsonReport.generated_at}. Model: ${model}. Source: ${dir}.`,
  `Images: ${imageFiles.length}. Judged: ${allResults.length}. Batch errors: ${errors.length}.`,
  "",
  "## Dimension means",
  "",
  "| dimension | mean |",
  "|---|---:|",
  ...DIMENSION_KEYS.map((k) => `| ${k} | ${dimensionMeans[k] ?? "n/a"} |`),
  `| **overall** | **${overallMean ?? "n/a"}** |`,
  "",
  "## Hard fails",
  "",
  `Cells with at least one hard fail: ${cellsWithHardFail}/${allResults.length}.`,
  "",
  "| hard fail | count |",
  "|---|---:|",
  ...HARD_FAIL_KEYS.map((k) => `| ${k} | ${hardFailCounts[k]} |`),
  "",
  "## Per-image",
  "",
  "| file | " + DIMENSION_KEYS.join(" | ") + " | hard fails | rationale |",
  "|---|" + DIMENSION_KEYS.map(() => "---:").join("|") + "|---|---|",
  ...allResults.map((r) => {
    const scores = DIMENSION_KEYS.map((k) => r?.dimensions?.[k]?.score ?? "n/a").join(" | ");
    const hf = HARD_FAIL_KEYS.filter((k) => r?.hard_fails?.[k] === true).join(", ") || "none";
    return `| ${cell(r.file)} | ${scores} | ${cell(hf)} | ${cell(r.overall_rationale)} |`;
  }),
  "",
  ...(errors.length
    ? ["## Batch errors", "", ...errors.map((e) => `- ${e.files.join(", ")}: ${cell(e.error)}`), ""]
    : []),
];
fs.writeFileSync(path.join(reportDir, "vision-judge-report.md"), md.join("\n"));

console.log(`\noverall mean: ${overallMean ?? "n/a"}   cells with a hard fail: ${cellsWithHardFail}/${allResults.length}`);
console.log(`report written: ${path.join(reportDir, "vision-judge-report.json")}`);
console.log(`report written: ${path.join(reportDir, "vision-judge-report.md")}`);
if (errors.length > 0 && allResults.length === 0) process.exit(1);
