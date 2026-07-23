#!/usr/bin/env node
/**
 * check-i18n-keys — mobile-app localization gate.
 *
 * Two checks, both enforced:
 *
 *   1. Locale parity (zero baseline)
 *      en.json, es.json and ko.json must expose the identical set of leaf keys.
 *      A key added to en but not es/ko means Spanish/Korean users silently fall
 *      back to English; a key in es/ko but not en is an orphan/typo. Either fails.
 *
 *   2. Used-key resolvability (baseline-allowlisted)
 *      Every static t("ns.key") used in app/components/hooks/lib must resolve in
 *      en.json — as the base key OR any i18next plural form (key_one, key_other,
 *      …). A defaultValue does NOT exempt it: a string that lives only as a
 *      t(..., { defaultValue }) renders English for es/ko users and is invisible
 *      to parity. That masking bug is exactly what this check exists to stop.
 *      Pre-existing offenders live in scripts/i18n-key-baseline.json so the gate
 *      blocks NEW drift immediately while the backlog is backfilled in batches.
 *
 * Dynamic keys — t(`ns.${x}`) — cannot be verified statically; they are listed
 * as info and never fail the gate.
 *
 * Usage:
 *   node scripts/check-i18n-keys.mjs                # verify (exit 1 on failure)
 *   node scripts/check-i18n-keys.mjs --update-baseline   # rewrite the allowlist
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIRS = ["app", "components", "hooks", "lib"];
const LOCALES_DIR = join(ROOT, "lib", "i18n", "locales");
const BASELINE_PATH = join(ROOT, "scripts", "i18n-key-baseline.json");
// i18next Intl plural categories. A key used with { count } resolves through
// these suffixes rather than the bare path.
const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"];
const UPDATE = process.argv.includes("--update-baseline");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function hasKey(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split(".")) {
    if (cur == null || typeof cur !== "object" || !(part in cur)) return false;
    cur = cur[part];
  }
  return typeof cur === "string";
}

// Resolves if the base key or any plural variant is a string in the locale.
function resolves(locale, key) {
  if (hasKey(locale, key)) return true;
  return PLURAL_SUFFIXES.some((s) => hasKey(locale, `${key}_${s}`));
}

function leafKeys(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") leafKeys(v, path, out);
    else if (typeof v === "string") out.push(path);
  }
  return out;
}

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (
      [".ts", ".tsx", ".js", ".jsx"].includes(extname(name)) &&
      !/\.(test|spec)\.[jt]sx?$/.test(name)
    ) {
      files.push(full);
    }
  }
  return files;
}

// From the '(' after t, return the balanced call text (string-literal aware).
function extractCall(text, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === inStr && text[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return text.slice(openIdx, Math.min(text.length, openIdx + 400));
}

const rel = (f) => f.slice(ROOT.length + 1).replace(/\\/g, "/");

function collectUsage(files) {
  const callRe = /\bt\(/g;
  const keyRe = /^\(\s*(["'`])([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\1/;
  const usage = new Map(); // key -> { sites:[{file,hasDefaultValue}] }
  const dynamic = []; // {file}
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    let m;
    while ((m = callRe.exec(text))) {
      const openIdx = m.index + 1;
      const call = extractCall(text, openIdx);
      const km = keyRe.exec(call);
      if (!km) {
        if (/^\(\s*`[^`]*\$\{/.test(call)) dynamic.push({ file: rel(f) });
        continue;
      }
      const key = km[2];
      const hasDefaultValue = /\bdefaultValue\b/.test(call);
      if (!usage.has(key)) usage.set(key, { sites: [] });
      usage.get(key).sites.push({ file: rel(f), hasDefaultValue });
    }
  }
  return { usage, dynamic };
}

// ---------------------------------------------------------------------------
const en = readJson(join(LOCALES_DIR, "en.json"));
const es = readJson(join(LOCALES_DIR, "es.json"));
const ko = readJson(join(LOCALES_DIR, "ko.json"));

const files = SRC_DIRS.flatMap((d) => walk(join(ROOT, d)));
const { usage, dynamic } = collectUsage(files);

// Check 2 data: used keys unresolved in en.
const unresolved = [];
for (const [key, { sites }] of usage) {
  if (resolves(en, key)) continue;
  const bare = sites.some((s) => !s.hasDefaultValue);
  unresolved.push({ key, bare, files: [...new Set(sites.map((s) => s.file))] });
}
unresolved.sort((a, b) => a.key.localeCompare(b.key));

if (UPDATE) {
  const payload = {
    _comment:
      "Keys used in source but absent from en.json (they render English via a t() defaultValue, or a raw key if bare). Localize into en/es/ko then remove here. Regenerate: npm run check:i18n-keys -- --update-baseline",
    unresolvedInEn: unresolved.map((u) => u.key),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Baseline written: ${unresolved.length} keys -> ${rel(BASELINE_PATH)}`);
  process.exit(0);
}

let baseline;
try {
  baseline = new Set(readJson(BASELINE_PATH).unresolvedInEn ?? []);
} catch {
  baseline = new Set();
}

// Check 1: parity.
const enLeaves = leafKeys(en);
const esLeaves = new Set(leafKeys(es));
const koLeaves = new Set(leafKeys(ko));
const enSet = new Set(enLeaves);
const missingEs = enLeaves.filter((k) => !esLeaves.has(k));
const missingKo = enLeaves.filter((k) => !koLeaves.has(k));
const orphanEs = [...esLeaves].filter((k) => !enSet.has(k));
const orphanKo = [...koLeaves].filter((k) => !enSet.has(k));

// Check 2: new unresolved (not baseline-allowlisted).
const newUnresolved = unresolved.filter((u) => !baseline.has(u.key));
const stale = [...baseline].filter((k) => !unresolved.some((u) => u.key === k));

const errors = [];
if (missingEs.length) errors.push(`es.json missing ${missingEs.length} key(s) present in en.json`);
if (missingKo.length) errors.push(`ko.json missing ${missingKo.length} key(s) present in en.json`);
if (orphanEs.length) errors.push(`es.json has ${orphanEs.length} key(s) not in en.json`);
if (orphanKo.length) errors.push(`ko.json has ${orphanKo.length} key(s) not in en.json`);
if (newUnresolved.length) errors.push(`${newUnresolved.length} new t() key(s) not in en.json and not baselined`);

console.log("i18n key gate");
console.log(`  source files scanned : ${files.length}`);
console.log(`  static t() keys used : ${usage.size}`);
console.log(`  en/es/ko leaf keys   : ${enLeaves.length}/${esLeaves.size}/${koLeaves.size}`);
console.log(`  baselined debt keys  : ${baseline.size}`);
console.log(`  dynamic t(\`\${…}\`)    : ${dynamic.length} (not statically checked)`);

const show = (label, list, n = 25) => {
  console.log(`\n${label} (${list.length}):`);
  for (const k of list.slice(0, n)) console.log(`  - ${typeof k === "string" ? k : k.key}`);
  if (list.length > n) console.log(`  …and ${list.length - n} more`);
};

if (missingEs.length) show("MISSING from es.json", missingEs);
if (missingKo.length) show("MISSING from ko.json", missingKo);
if (orphanEs.length) show("ORPHAN in es.json (not in en)", orphanEs);
if (orphanKo.length) show("ORPHAN in ko.json (not in en)", orphanKo);
if (newUnresolved.length) {
  console.log(`\nNEW keys absent from en.json (${newUnresolved.length}):`);
  for (const u of newUnresolved) {
    const kind = u.bare ? "RAW KEY shown to users" : "renders English via defaultValue";
    console.log(`  - ${u.key}  [${kind}]  ${u.files.join(", ")}`);
  }
  console.log("  Fix: add the key to en.json + es.json + ko.json (localized).");
  console.log("  Or, if intentionally deferred: npm run check:i18n-keys -- --update-baseline");
}
if (stale.length) {
  console.log(`\nInfo: ${stale.length} baselined key(s) now resolve — prune with --update-baseline:`);
  for (const k of stale.slice(0, 25)) console.log(`  - ${k}`);
}

if (errors.length) {
  console.log(`\nFAIL:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("\nPASS: locale parity holds and no new untranslated t() keys.");
process.exit(0);
