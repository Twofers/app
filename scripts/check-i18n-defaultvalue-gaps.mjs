// Detect the localization-gap class the standard i18n gate misses:
// `t("key", { defaultValue: "English" })` or `t("key", "English")` where the
// key is ABSENT from es/ko (and/or en). Because i18next is configured
// fallbackLng:"en" and honors defaultValue, these render English for Spanish
// and Korean users while typecheck/lint/`check:i18n-keys` all stay green.
//
// Read-only. Scans app/ and components/. Exit 0 = no gaps, 1 = gaps found.
// Run: node scripts/check-i18n-defaultvalue-gaps.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components", "lib", "hooks"];
const LOCALES = ["en", "es", "ko"];

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const locale = {};
for (const l of LOCALES) {
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, `lib/i18n/locales/${l}.json`), "utf8"));
  locale[l] = flatten(raw);
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(p, files);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      files.push(p);
    }
  }
  return files;
}

// Match t("key" , { ... defaultValue ... })  OR  t("key", "positional default")
// Key charset restricted to typical i18n key chars so we don't catch t(variable).
const DV_OBJECT = /\bt\(\s*["'`]([A-Za-z0-9_.]+)["'`]\s*,\s*\{[^}]*\bdefaultValue\b/g;
const DV_POSITIONAL = /\bt\(\s*["'`]([A-Za-z0-9_.]+)["'`]\s*,\s*["'`]/g;

const gaps = [];
const seen = new Set();
for (const dir of SCAN_DIRS) {
  let files;
  try { files = walk(path.join(REPO_ROOT, dir)); } catch { continue; }
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const re of [DV_OBJECT, DV_POSITIONAL]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const key = m[1];
        const missing = LOCALES.filter((l) => !(key in locale[l]));
        // Also flag keys present but byte-identical to en in es AND ko (untranslated).
        // Skip values whose non-interpolation part has no lowercase letters —
        // format acronyms ("CSV"/"PDF") and pure "{{placeholder}}" values are
        // correctly identical across locales and must not be flagged.
        const strippedEn = typeof locale.en[key] === "string"
          ? locale.en[key].replace(/\{\{[^}]+\}\}/g, "")
          : "";
        const untranslated = missing.length === 0 &&
          locale.es[key] === locale.en[key] && locale.ko[key] === locale.en[key] &&
          /[a-z]/.test(strippedEn);
        if (missing.length === 0 && !untranslated) continue;
        const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
        const id = `${key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        gaps.push({ key, file: rel, missing, untranslated });
      }
    }
  }
}

gaps.sort((a, b) => a.key.localeCompare(b.key));

// ---------------------------------------------------------------------------
// Check 2: interpolation-placeholder consistency across locales.
//
// A locale whose value carries a {{placeholder}} the English source lacks will
// render whatever the call site passes — including raw server error detail that
// the English string deliberately sanitizes (found 2026-07-24: es/ko
// apiErrors.claimCreateFailed appended {{detail}} while en did not). The
// reverse (en has a placeholder the translation drops) silently loses data.
// Neither is visible to `check:i18n-keys`, which only compares key presence.
//
// Baselined: values that legitimately differ and need a product decision.
const PLACEHOLDER_BASELINE = new Set([
  // en "Revision {{number}}" vs es "Ajuste" / ko "수정" — es/ko omit the version
  // number. Rendered by app/create/ai.tsx, which is covered by the AI poster
  // core lock, so changing this copy needs Dan's per-file approval.
  "createAi.imageVersionRevision",
]);

const placeholdersOf = (v) =>
  (String(v).match(/\{\{[^}]+\}\}/g) ?? []).map((s) => s.replace(/\s+/g, "")).sort().join(",");

const phIssues = [];
for (const key of Object.keys(locale.en)) {
  if (PLACEHOLDER_BASELINE.has(key)) continue;
  const base = placeholdersOf(locale.en[key]);
  for (const l of ["es", "ko"]) {
    if (!(key in locale[l])) continue;
    const got = placeholdersOf(locale[l][key]);
    if (got !== base) phIssues.push({ key, locale: l, en: base || "(none)", other: got || "(none)" });
  }
}

if (gaps.length === 0 && phIssues.length === 0) {
  console.log("i18n consistency check: PASS — no defaultValue-masked keys, no placeholder drift.");
  if (PLACEHOLDER_BASELINE.size) {
    console.log(`(${PLACEHOLDER_BASELINE.size} placeholder difference(s) baselined: ${[...PLACEHOLDER_BASELINE].join(", ")})`);
  }
  process.exit(0);
}

if (gaps.length) {
  console.log(`i18n defaultValue-gap check: ${gaps.length} gap(s) found\n`);
  for (const g of gaps) {
    const tag = g.untranslated ? "UNTRANSLATED (es==ko==en)" : `MISSING in ${g.missing.join(",")}`;
    console.log(`  ${g.key}\n      ${tag}\n      seen: ${g.file}`);
  }
}
if (phIssues.length) {
  console.log(`\ni18n placeholder-drift check: ${phIssues.length} mismatch(es) found\n`);
  for (const p of phIssues) {
    console.log(`  ${p.key}\n      en has ${p.en}, ${p.locale} has ${p.other}`);
  }
}
process.exit(1);
