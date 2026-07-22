#!/usr/bin/env node
/**
 * Website localization parity check.
 *
 * Verifies three things about website/localization.js and the pages that use it:
 *   1. en, es and ko define exactly the same set of keys.
 *   2. Every data-i18n* key referenced in any website HTML file resolves.
 *   3. Reports keys defined but never referenced (informational only).
 *
 * Failures 1 and 2 exit non-zero. Unused keys do not fail the build: some are
 * used from JS at runtime (form status strings, launch-signup states) rather
 * than from a data-i18n attribute in markup.
 *
 * Note on parsing: locales are declared as a base block (`    en: {`) and then
 * extended with `Object.assign(messages.en, { ... })` blocks further down. A
 * checker that only reads the base block silently misses ~200 keys per locale
 * and reports false "missing" failures, so both forms are collected here.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const SITE_ROOT = path.join(ROOT, "website");
const LOCALES = ["en", "es", "ko"];

const src = fs.readFileSync(path.join(SITE_ROOT, "localization.js"), "utf8");

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

function keysForLocale(locale) {
  const blocks = [];

  const baseIndex = src.search(new RegExp(`^\\s+${locale}: \\{`, "m"));
  if (baseIndex >= 0) blocks.push(braceSpan(baseIndex));

  const extendRe = new RegExp(`Object\\.assign\\(messages\\.${locale},\\s*\\{`, "g");
  let match;
  while ((match = extendRe.exec(src))) blocks.push(braceSpan(match.index));

  return {
    blockCount: blocks.length,
    keys: new Set(blocks.flatMap((block) => [...block.matchAll(/"([^"]+)":/g)].map((m) => m[1]))),
  };
}

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

const failures = [];
const defined = {};

for (const locale of LOCALES) {
  const { blockCount, keys } = keysForLocale(locale);
  if (!blockCount) {
    failures.push(`localization.js: no message block found for locale "${locale}"`);
    defined[locale] = new Set();
    continue;
  }
  defined[locale] = keys;
}

const reference = defined.en;
for (const locale of LOCALES.filter((l) => l !== "en")) {
  for (const key of reference) {
    if (!defined[locale].has(key)) failures.push(`${locale}: missing key "${key}" (defined in en)`);
  }
  for (const key of defined[locale]) {
    if (!reference.has(key)) failures.push(`${locale}: key "${key}" has no en counterpart`);
  }
}

const usedBy = new Map();
for (const file of htmlFiles(SITE_ROOT)) {
  const html = fs.readFileSync(file, "utf8");
  for (const match of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
    const rel = path.relative(ROOT, file);
    if (!usedBy.has(match[1])) usedBy.set(match[1], []);
    usedBy.get(match[1]).push(rel);
  }
}

for (const [key, files] of usedBy) {
  if (!reference.has(key)) failures.push(`${files[0]}: data-i18n key "${key}" is not defined in en`);
}

if (failures.length) {
  console.error("Website i18n check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const unused = [...reference].filter((key) => !usedBy.has(key));
console.log(
  `Website i18n check passed: ${reference.size} keys x ${LOCALES.length} locales, ` +
    `${usedBy.size} keys referenced across HTML.`
);
if (unused.length) {
  console.log(`Note: ${unused.length} keys are not referenced from markup (may be used from JS).`);
}
