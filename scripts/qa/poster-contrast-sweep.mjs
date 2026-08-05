// [aiqa] poster-quality — contrast sweep runner over a corpus of background images.
//
// Batches scripts/qa/poster-contrast-check.mjs's modeled-scrim WCAG contrast check (see
// that file's header) across every image in a directory, aggregates PASS/WARN/FAIL per
// image and per block, and writes a JSON + Markdown report. Exits nonzero if any block
// is a mechanical hard fail (large text <3:1, small text <4.5:1 — see verdict() in
// poster-contrast-check.mjs), matching that script's own gate semantics.
//
// poster-contrast-check.mjs has no exported functions (it is a plain top-level-executing
// CLI, and it is a locked file this tool must not modify), so V1 geometry is scored by
// SPAWNING it per image and parsing its stdout. V2 ("Poster Look v2", flag-gated) has no
// support in that script at all, so --geometry v2 models the V2 text blocks independently
// in this file, derived from components/poster/AdPosterCanvas.tsx (read-only source; see
// per-block comments below for the exact source lines each number came from) and
// components/poster/posterTemplates.ts (read-only, for the THEME colors).
//
// Usage:
//   node scripts/qa/poster-contrast-sweep.mjs --dir artifacts/poster-quality/2026-07-20-run2/corpus
//   node scripts/qa/poster-contrast-sweep.mjs --dir <dir> --template fresh --onimage
//   node scripts/qa/poster-contrast-sweep.mjs --dir <dir> --geometry v2 --template premium
//   node scripts/qa/poster-contrast-sweep.mjs --dir <dir> --report-dir artifacts/poster-quality/contrast-sweep
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRAST_CHECK = path.join(__dirname, "poster-contrast-check.mjs");

const VALUE_FLAGS = new Set(["dir", "files", "template", "geometry", "report-dir", "floor"]);
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

if (!args.dir && !args.files) {
  console.log(
    "usage: node scripts/qa/poster-contrast-sweep.mjs --dir <corpus-dir> [--template fresh|bold|premium]\n" +
      "                                              [--onimage] [--geometry v1|v2] [--report-dir <dir>]\n" +
      "   or: node scripts/qa/poster-contrast-sweep.mjs --files a.png,b.png,c.png [...]",
  );
  process.exit(1);
}

const template = String(args.template || "fresh");
const geometry = String(args.geometry || "v1");
if (!["v1", "v2"].includes(geometry)) {
  console.error(`--geometry must be v1 or v2 (got ${geometry})`);
  process.exit(1);
}

function listPngs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listPngs(full));
    else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const files = args.files ? String(args.files).split(",").map((s) => s.trim()).filter(Boolean) : listPngs(String(args.dir));

if (files.length === 0) {
  console.error(`no .png files found under ${args.dir || args.files}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// V1 path: spawn the locked script per file and parse its stdout table.
// ---------------------------------------------------------------------------

// Matches poster-contrast-check.mjs's per-block print line, e.g.:
//   "  headline         text=#063D3A effBg=rgb(37,37,31) scrim=0.64  contrast=1.28:1  FAIL"
const BLOCK_LINE_RE = /^\s{2}(\S+)\s+text=(\S+)\s+(?:effBg|bg)=rgb\(([^)]+)\)\s+(?:scrim=\S+\s+)?contrast=([\d.]+):1\s+(PASS|WARN|FAIL)\s*$/;

function runV1(file) {
  const cliArgs = ["--bg", file, "--template", template];
  if (args.onimage) cliArgs.push("--onimage");
  const res = spawnSync(process.execPath, [CONTRAST_CHECK, ...cliArgs], { encoding: "utf8" });
  if (res.status !== 0 && !res.stdout) {
    return { file, error: res.stderr?.trim() || `poster-contrast-check.mjs exited ${res.status}`, blocks: [] };
  }
  const blocks = [];
  for (const line of (res.stdout || "").split("\n")) {
    const m = BLOCK_LINE_RE.exec(line);
    if (m) blocks.push({ key: m[1], text_color: m[2], bg_rgb: m[3], contrast: Number(m[4]), verdict: m[5] });
  }
  return { file, blocks, raw: res.stdout };
}

// ---------------------------------------------------------------------------
// V2 path: model the Poster Look v2 blocks independently (this script only —
// components/poster/AdPosterCanvas.tsx and posterTemplates.ts are read-only sources,
// never edited by this tool).
// ---------------------------------------------------------------------------

const CANVAS_H = 1350; // components/poster/AdPosterCanvas.tsx:29 POSTER_CANVAS_HEIGHT

// THEME colors, verbatim from components/poster/posterTemplates.ts POSTER_TEMPLATES
// (lines 18-55). Duplicated here (not imported) because that file is TSX read through a
// bundler alias (@/...) that a plain node script cannot resolve, and it is a locked file
// this tool must not modify to add an export.
const THEME = {
  fresh: { headline: "#063D3A", business: "#0F3A37", subline: "#37635F", accent: "#F6C445" },
  bold: { headline: "#FFFFFF", business: "#FFFFFF", subline: "#FDE68A", accent: "#22C55E" },
  premium: { headline: "#FFF4DC", business: "#FFF9ED", subline: "#E7BE79", accent: "#D89A40" },
};
// components/poster/AdPosterCanvas.tsx:70-71 — light ink used over a photo.
const ON_IMAGE_INK = { headline: "#FFFFFF", business: "#EFEAE1", subline: "#EFEAE1", accent: "#F6C445" };
// components/poster/AdPosterCanvas.tsx:48 POSTER_V2_BADGE_TEXT_COLOR — fixed dark ink used
// ONLY on the V2 offer badge, regardless of template or on-image mode (:738).
const V2_BADGE_TEXT_COLOR = "#221507";

// V2 text blocks (canvas coords, 1080x1350). y/h approximate the band each block's text
// occupies, in the same spirit as poster-contrast-check.mjs's V1_BLOCKS (see that file's
// comment at line 30: "y/h chosen to cover each text line's band"). Source line numbers
// below cite components/poster/AdPosterCanvas.tsx as read for this task.
const V2_BLOCKS = [
  // PosterLineV2 business_name: top=44 (:618), size=30/lineHeight=36 (POSTER_V2_BUSINESS_*, :49-50)
  { key: "business", y: 44, h: 50, big: false, colorKey: "business", bg: "scrim" },
  // eyebrow/kicker: top=92 (:632), size=36/lineHeight=42 (POSTER_V2_EYEBROW_*, :52-53)
  { key: "kicker", y: 92, h: 54, big: true, colorKey: "accent", bg: "scrim" },
  // headline (hero): top=148 (:643), size=84/lineHeight=90 (POSTER_V2_HERO_*, :54-55), lines=2
  { key: "headline", y: 148, h: 190, big: true, colorKey: "headline", bg: "scrim" },
  // Offer badge (primary line): OfferBlockV2 wrapper top=1036 (:715). The badge itself is an
  // OPAQUE gold pill — backgroundColor: theme.accent (:725) with paddingVertical=16 (:728)
  // around size=56/lineHeight=62 text (POSTER_V2_BADGE_*, :56-57, :686-688) -> badge box
  // height ~= 62 + 2*16 = 94. Text color is the fixed V2_BADGE_TEXT_COLOR (:738), NOT the
  // theme accent, and — unlike every other V2 block — its background is the pill's own
  // solid fill, not the scrimmed photo behind it (bg: "badge" below).
  { key: "offer_primary", y: 1036, h: 94, big: true, colorKey: "badge", bg: "badge" },
  // offer_secondary: marginTop=24 after the badge (:756), size=50/lineHeight=58
  // (POSTER_V2_OFFER_LINE_*, :58-59), maxLines=2. y estimated as badge bottom (1036+94) + 24.
  { key: "offer_secondary", y: 1154, h: 126, big: true, colorKey: "headline", bg: "scrim" },
  // schedule: top=1290 (:774), size=26/lineHeight=32 (POSTER_V2_SCHEDULE_*, :60-61)
  { key: "schedule", y: 1290, h: 40, big: false, colorKey: "subline", bg: "scrim" },
];

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const over = (fg, fa, bg) => fg * fa + bg * (1 - fa);
const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
function verdict(cr, big) {
  const floor = big ? Number(args.floor || 3.0) : 4.5;
  if (cr < floor) return "FAIL";
  if (cr < 4.5) return "WARN";
  return "PASS";
}
function meanRegion(png, x0, y0, w, h) {
  const { width, data } = png;
  let r = 0, g = 0, b = 0, n = 0;
  const xe = Math.min(width, x0 + w), ye = Math.min(png.height, y0 + h);
  for (let y = Math.max(0, y0); y < ye; y += 2) {
    for (let x = Math.max(0, x0); x < xe; x += 2) {
      const idx = (width * y + x) << 2;
      r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}
// Premium 7-stop full-canvas scrim (components/poster/AdPosterCanvas.tsx:272-286, PosterBackground),
// mirrored from poster-contrast-check.mjs's SCRIM_STOPS/scrimAlphaAt so v2 gets the same
// approximation for the "premium" template's overlay.
const SCRIM_STOPS = [0.92, 0.66, 0.18, 0.0, 0.12, 0.82, 0.98];
function scrimAlphaAt(yFrac) {
  const seg = yFrac * (SCRIM_STOPS.length - 1);
  const i = Math.min(SCRIM_STOPS.length - 2, Math.floor(seg));
  const t = seg - i;
  return SCRIM_STOPS[i] * (1 - t) + SCRIM_STOPS[i + 1] * t;
}
// fresh teal wash (AdPosterCanvas.tsx:259-263), mirrored the same way.
function tealWashAt(yFrac) {
  const stops = [0.42, 0.08, 0.18];
  const seg = yFrac * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const t = seg - i;
  return stops[i] * (1 - t) + stops[i + 1] * t;
}
const TEAL = [4, 84, 86];
// V2's OfferBlockV2 bottom scrim differs from V1's OfferBlock: colors
// ["rgba(0,0,0,0.00)","rgba(0,0,0,0.55)","rgba(0,0,0,0.86)"], locations [0,0.38,1]
// (AdPosterCanvas.tsx:699-710) — softer than V1's [0,0.70,0.98] @ [0,0.26,1].
function offerScrimAlphaAtV2(y) {
  if (y < 888) return 0; // POSTER_BOTTOM_BAND_TOP, AdPosterCanvas.tsx:33
  const f = (y - 888) / (CANVAS_H - 888);
  const stops = [0.0, 0.55, 0.86], locs = [0, 0.38, 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (f <= locs[i + 1]) {
      const t = (f - locs[i]) / (locs[i + 1] - locs[i]);
      return stops[i] * (1 - t) + stops[i + 1] * t;
    }
  }
  return 0.86;
}

function runV2(file) {
  if (!fs.existsSync(file)) return { file, error: "file not found", blocks: [] };
  let png;
  try {
    png = PNG.sync.read(fs.readFileSync(file));
  } catch (e) {
    return { file, error: `PNG decode failed: ${e.message}`, blocks: [] };
  }
  const theme = args.onimage ? ON_IMAGE_INK : THEME[template] || THEME.fresh;
  const sy = png.height / CANVAS_H;
  const blocks = [];
  for (const blk of V2_BLOCKS) {
    const yc = (blk.y + blk.h / 2) / CANVAS_H;
    let txt;
    let eff;
    let bgDesc;
    if (blk.bg === "badge") {
      // Badge text is always V2_BADGE_TEXT_COLOR on an opaque theme.accent pill — no
      // dependency on the photo at all.
      txt = hexToRgb(V2_BADGE_TEXT_COLOR);
      eff = hexToRgb(theme.accent);
      bgDesc = `badge-fill(${theme.accent})`;
    } else {
      const base = meanRegion(png, 0, Math.round(blk.y * sy), png.width, Math.round(blk.h * sy));
      eff = base.slice();
      const ta = tealWashAt(yc);
      eff = eff.map((c, i) => over(TEAL[i], ta, c));
      const sa = scrimAlphaAt(yc);
      eff = eff.map((c) => over(0, sa, c));
      const oa = offerScrimAlphaAtV2(blk.y + blk.h / 2);
      eff = eff.map((c) => over(0, oa, c));
      txt = hexToRgb(theme[blk.colorKey]);
      bgDesc = `rgb(${eff.map((c) => Math.round(c)).join(",")})`;
    }
    const cr = contrast(txt, eff);
    const v = verdict(cr, blk.big);
    blocks.push({
      key: blk.key,
      text_color: blk.bg === "badge" ? V2_BADGE_TEXT_COLOR : theme[blk.colorKey],
      bg: bgDesc,
      contrast: Number(cr.toFixed(2)),
      verdict: v,
    });
  }
  return { file, blocks };
}

// ---------------------------------------------------------------------------
// Run + aggregate
// ---------------------------------------------------------------------------

const results = files.map((f) => (geometry === "v1" ? runV1(f) : runV2(f)));

let totalBlocks = 0;
let failBlocks = 0;
let warnBlocks = 0;
const failsByKey = {};
for (const r of results) {
  for (const b of r.blocks) {
    totalBlocks += 1;
    if (b.verdict === "FAIL") { failBlocks += 1; failsByKey[b.key] = (failsByKey[b.key] || 0) + 1; }
    if (b.verdict === "WARN") warnBlocks += 1;
  }
}
const erroredFiles = results.filter((r) => r.error);

console.log(`\n=== poster-contrast-sweep (geometry=${geometry} template=${template}${args.onimage ? " onimage" : ""}) ===`);
console.log(`images: ${results.length}   blocks scored: ${totalBlocks}   FAIL: ${failBlocks}   WARN: ${warnBlocks}`);
if (erroredFiles.length) {
  console.log(`\nerrors (${erroredFiles.length}):`);
  for (const r of erroredFiles) console.log(`  ${r.file}: ${r.error}`);
}
console.log("\nper-image:");
for (const r of results) {
  if (r.error) continue;
  const fails = r.blocks.filter((b) => b.verdict === "FAIL").map((b) => b.key);
  console.log(`  ${r.file}${fails.length ? `  -> FAIL: ${fails.join(", ")}` : "  -> ok"}`);
}
if (Object.keys(failsByKey).length) {
  console.log("\nfailing blocks by key (which text block breaks most often):");
  for (const [key, count] of Object.entries(failsByKey).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${key}: ${count}`);
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const reportDir = String(args["report-dir"] || (args.dir ? path.join(String(args.dir), "contrast-sweep-report") : "contrast-sweep-report"));
fs.mkdirSync(reportDir, { recursive: true });

const jsonReport = {
  generated_at: new Date().toISOString(),
  geometry,
  template,
  onimage: Boolean(args.onimage),
  source: args.dir ? String(args.dir) : "explicit --files list",
  image_count: results.length,
  block_count: totalBlocks,
  fail_count: failBlocks,
  warn_count: warnBlocks,
  errored_files: erroredFiles.map((r) => ({ file: r.file, error: r.error })),
  results: results.map((r) => ({ file: r.file, error: r.error ?? null, blocks: r.blocks })),
};
fs.writeFileSync(path.join(reportDir, "contrast-sweep-report.json"), JSON.stringify(jsonReport, null, 2));

const md = [
  "# Poster contrast sweep report",
  "",
  `Generated ${jsonReport.generated_at}. geometry=${geometry} template=${template}${args.onimage ? " onimage" : ""}.`,
  `Source: ${jsonReport.source}`,
  "",
  `Images: ${results.length}. Blocks scored: ${totalBlocks}. FAIL: ${failBlocks}. WARN: ${warnBlocks}.`,
  "",
  "| image | block | text | bg | contrast | verdict |",
  "|---|---|---|---|---:|---|",
  ...results.flatMap((r) =>
    r.error
      ? [`| ${r.file} | (error) | | | | ${r.error.replace(/\|/g, "/")} |`]
      : r.blocks.map((b) => `| ${r.file} | ${b.key} | ${b.text_color} | ${b.bg} | ${b.contrast.toFixed(2)}:1 | ${b.verdict} |`),
  ),
  "",
];
fs.writeFileSync(path.join(reportDir, "contrast-sweep-report.md"), md.join("\n"));

console.log(`\nreport written: ${path.join(reportDir, "contrast-sweep-report.json")}`);
console.log(`report written: ${path.join(reportDir, "contrast-sweep-report.md")}`);

if (failBlocks > 0) {
  console.log(`\nFAIL: ${failBlocks} block(s) below the mechanical contrast floor.`);
  process.exit(1);
}
console.log("\nPASS: no blocks below the mechanical contrast floor.");
