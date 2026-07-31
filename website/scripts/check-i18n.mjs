#!/usr/bin/env node
/**
 * i18n coverage gate for the static site.
 *
 * Scans every HTML file under website/ for `data-i18n` and `data-i18n-content`
 * attributes, collects the referenced key set, then checks that each key is
 * defined for en, es AND ko. Any key missing from a language would fall back to
 * English at runtime (see textFor() in localization.js) -- i.e. a Korean or
 * Spanish page silently shipping an English string. That is exactly what this
 * gate blocks: it exits non-zero and prints the missing keys grouped by
 * language.
 *
 * No dependencies outside Node builtins.
 *
 * Path note: everything is resolved relative to THIS file, not process.cwd(),
 * so it behaves identically whether run from the repo root
 * (`node website/scripts/check-i18n.mjs`) or from website/ during the Vercel
 * build (`node scripts/check-i18n.mjs`).
 *
 * Parsing note: each locale is declared as a base block (`    en: {`) and then
 * extended with `Object.assign(messages.en, { ... })` blocks lower down. A
 * checker that reads only the base block misses ~200 keys per locale and
 * reports false failures, so both forms are collected here.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "es", "ko"];

const src = fs.readFileSync(path.join(SITE_ROOT, "localization.js"), "utf8");

// Return the text of the {...} block whose opening brace is the first "{" at or
// after fromIndex, balanced to its matching close.
function braceSpan(fromIndex) {
  const open = src.indexOf("{", fromIndex);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i);
    }
  }
  return src.slice(open);
}

function definedKeys(locale) {
  const blocks = [];
  const baseIndex = src.search(new RegExp(`^\\s+${locale}: \\{`, "m"));
  if (baseIndex >= 0) blocks.push(braceSpan(baseIndex));

  const extendRe = new RegExp(`Object\\.assign\\(messages\\.${locale},\\s*\\{`, "g");
  let match;
  while ((match = extendRe.exec(src))) blocks.push(braceSpan(match.index));

  const keys = new Set();
  for (const block of blocks) {
    for (const [, key] of block.matchAll(/"([^"]+)":/g)) keys.add(key);
  }
  return { blockCount: blocks.length, keys };
}

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

// Referenced keys: data-i18n="..." and data-i18n-content="..." only.
const referenced = new Set();
for (const file of htmlFiles(SITE_ROOT)) {
  const html = fs.readFileSync(file, "utf8");
  for (const [, key] of html.matchAll(/\sdata-i18n(?:-content)?="([^"]+)"/g)) {
    referenced.add(key);
  }
}

if (!referenced.size) {
  console.error("check-i18n: found no data-i18n/data-i18n-content keys in any HTML file.");
  process.exit(1);
}

const missingByLocale = {};
let missingTotal = 0;
for (const locale of LOCALES) {
  const { blockCount, keys } = definedKeys(locale);
  if (!blockCount) {
    console.error(`check-i18n: no message block found for locale "${locale}" in localization.js.`);
    process.exit(1);
  }
  const missing = [...referenced].filter((key) => !keys.has(key)).sort();
  if (missing.length) {
    missingByLocale[locale] = missing;
    missingTotal += missing.length;
  }
}

if (missingTotal) {
  console.error(
    `Website i18n check FAILED: ${missingTotal} missing translation(s) across ` +
      `${referenced.size} referenced key(s).\n`
  );
  for (const locale of LOCALES) {
    const missing = missingByLocale[locale];
    if (!missing) continue;
    console.error(`  ${locale} — missing ${missing.length}:`);
    for (const key of missing) console.error(`    ${key}`);
    console.error("");
  }
  process.exit(1);
}

console.log(
  `Website i18n check passed: ${referenced.size} referenced key(s) defined in all ` +
    `${LOCALES.length} locales (${LOCALES.join(", ")}).`
);
