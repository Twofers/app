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

function blocksForLocale(locale) {
  const blocks = [];

  const baseIndex = src.search(new RegExp(`^\\s+${locale}: \\{`, "m"));
  if (baseIndex >= 0) blocks.push(braceSpan(baseIndex));

  const extendRe = new RegExp(`Object\\.assign\\(messages\\.${locale},\\s*\\{`, "g");
  let match;
  while ((match = extendRe.exec(src))) blocks.push(braceSpan(match.index));

  return blocks;
}

function keysForLocale(locale) {
  const blocks = blocksForLocale(locale);
  return {
    blockCount: blocks.length,
    keys: new Set(blocks.flatMap((block) => [...block.matchAll(/"([^"]+)":/g)].map((m) => m[1]))),
  };
}

/**
 * Spanish strings shipped for months with their diacritics stripped
 * ("terminos", "Politica", "configuracion"). It reads as unproofread to a
 * native speaker, and at least one case changed meaning outright: "campana"
 * (a bell) where "campaña" (a campaign) was meant.
 *
 * This guard is a denylist of accent-less forms, not a spellchecker. Words are
 * listed only when the unaccented spelling is wrong in essentially any copy
 * this site would carry, so ambiguous pairs are deliberately absent: "mas"/
 * "más", "esta"/"está", "si"/"sí", "que"/"qué", "tu"/"tú", "aun"/"aún", and
 * verb forms that collide with the imperfect subjunctive ("guiara",
 * "actualizara"). Those need a human read, which is why the 2026-07-22 repair
 * pass was done by hand rather than by find-replace.
 *
 * A handful below (articulo, valido, titulo, limite, campana, ingles) do have
 * rare legitimate senses -- "yo articulo", "campana" as bell. They are listed
 * because those senses will not appear in deals copy. If one ever legitimately
 * does, delete that entry; do not weaken the check.
 *
 * Absent for the opposite reason: "publica" and "valida" collide with everyday
 * verbs ("el negocio publica", "Twofer valida"), and plurals such as
 * "opciones"/"revisiones" are correct unaccented -- only their singulars carry
 * the mark. Missing accents on those words have to be caught by eye.
 */
const ES_MISSING_DIACRITICS = [
  "activacion", "administracion", "analitica", "aprobacion", "aqui", "area",
  "articulo", "articulos", "autorizacion", "avisenme", "cafe", "cafes",
  "cafeteria", "cafeterias", "calcomanias", "campana", "campanas",
  "cancelacion", "categoria", "categorias", "codigo", "codigos", "colocacion",
  "companias", "composicion", "comunicacion", "configuracion", "confirmacion",
  "creacion", "cuentanos", "cumpleanos", "decision", "demas", "despues",
  "dia", "dias", "diagnosticos", "direccion", "disenador", "duenos", "dueno",
  "duracion", "efimera", "eliminacion", "enganosa", "enganosas", "enganoso",
  "envia", "espanol", "esten", "estan", "exhibicion", "explicito",
  "facturacion", "fisico", "gustaria", "habiles", "imagenes", "informacion",
  "ingles", "intentalo", "interes", "limite", "limites", "llevate", "manten",
  "mayoria", "menu", "metodo", "metodos", "metricas", "movil", "ningun",
  "numero", "ocurrio", "opcion", "pagina", "paginas",
  "panaderia", "panaderias", "politica", "politicas", "prevencion",
  "promocion", "publicacion", "puntuacion", "rapida", "rapido",
  "razon", "reclamacion", "reclamalas", "redaccion", "redencion", "revision",
  "segun", "sesion", "suscripcion", "suspension", "telefono", "terminos",
  "titulo", "tambien", "transcripcion", "ubicacion", "valido", "validos",
  "vencio",
];

function esSpellingFailures() {
  const found = [];
  const pattern = new RegExp(`\\b(${ES_MISSING_DIACRITICS.join("|")})\\b`, "gi");
  const pairRe = /"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/g;

  for (const block of blocksForLocale("es")) {
    for (const [, key, rawValue] of block.matchAll(pairRe)) {
      // Markup and URLs carry English by design (href="/delete-account").
      const prose = rawValue
        .replace(/<[^>]*>/g, " ")
        .replace(/\bhttps?:\/\/\S+/g, " ")
        .replace(/\b[\w.+-]+@[\w.-]+\b/g, " ");

      const hits = [...new Set([...prose.matchAll(pattern)].map((m) => m[0]))];
      if (hits.length) found.push(`es: "${key}" is missing diacritics: ${hits.join(", ")}`);
    }
  }
  return found;
}

// Keys defined more than once inside a locale: the last Object.assign wins, so
// the earlier copy is dead but still reads as live. Reported, not failed --
// en/es/ko all intentionally re-define thanks.* and trial.jump this way.
function duplicateKeyNotes(locale) {
  const seen = new Map();
  for (const block of blocksForLocale(locale)) {
    for (const [, key] of block.matchAll(/"([^"]+)":/g)) {
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
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

failures.push(...esSpellingFailures());

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

const duplicates = duplicateKeyNotes("es");
if (duplicates.length) {
  console.log(
    `Note: ${duplicates.length} key(s) defined more than once per locale (last wins): ${duplicates.join(", ")}.`
  );
}
