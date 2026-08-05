// Deterministic output gate for ai-translate-deal, applied before the AI
// translation result is written straight into the live `deals` row.
//
// This is a pure, unit-testable module: it never calls a network or a
// provider, it only inspects the six candidate translation fields and blanks
// (never fails) any field that looks wrong. Blanking a field is safe because
// the client already falls back to the deal's canonical English title/
// description whenever a translation column is empty (see
// supabase/functions/ai-translate-deal/index.ts fallbackResult/normalizeAiResult).
//
// The language-signal patterns below are mirrored from (not imported from,
// since that module is a read-only reference for this change)
// lib/ad-translation-qa.ts: HANGUL_PATTERN (:26), SPANISH_SIGNAL_PATTERN
// (:30), SPANISH_DIACRITIC_PATTERN (:32). The banned-shorthand check reuses
// the actual exported AD_COPY_BOGO_SHORTHAND_PATTERNS from
// lib/ad-language-policy.ts (same pattern already used by ad-translation-qa)
// plus the two extra shorthand terms ("1+1", "Same-Item") that
// lib/ad-source-locale-policy.ts adds on top of it.

import { AD_COPY_BOGO_SHORTHAND_PATTERNS, matchesAdCopyPattern } from "../../../lib/ad-language-policy.ts";

export type DealTranslationGateFields = {
  title_en: string;
  title_es: string;
  title_ko: string;
  description_en: string;
  description_es: string;
  description_ko: string;
};

export type DealTranslationGateOutcome = {
  fields: DealTranslationGateFields;
  blankedFields: string[];
};

export const DEAL_TRANSLATION_TITLE_MAX_LENGTH = 120;
export const DEAL_TRANSLATION_DESCRIPTION_MAX_LENGTH = 500;

// Mirrors lib/ad-translation-qa.ts:26.
const HANGUL_PATTERN = /[ᄀ-ᇿ㄰-㆏가-힯]/;
// Mirrors lib/ad-translation-qa.ts:30.
const SPANISH_SIGNAL_PATTERN =
  /\b(?:al|beneficio|comprar|con|disponible|en|gratis|hoy|local|oferta|para|recibe|recibes|tu)\b/i;
// Mirrors lib/ad-translation-qa.ts:32.
const SPANISH_DIACRITIC_PATTERN = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;

// lib/ad-source-locale-policy.ts bannedShorthand lists add "1+1" and
// "Same-Item" on top of AD_COPY_BOGO_SHORTHAND_PATTERNS (BOGO / 2-for-1 /
// two-for-one / 2x1).
const EXTRA_BANNED_SHORTHAND_PATTERNS = [
  /\b1\s*\+\s*1\b/i,
  /\bsame[- ]item\b/i,
] as const;

function hasBannedShorthand(text: string): boolean {
  return matchesAdCopyPattern(text, AD_COPY_BOGO_SHORTHAND_PATTERNS) ||
    matchesAdCopyPattern(text, EXTRA_BANNED_SHORTHAND_PATTERNS);
}

function normalizeForCompare(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMeaningfullyDifferent(candidate: string, source: string): boolean {
  if (!candidate) return false;
  if (!source) return true;
  return normalizeForCompare(candidate) !== normalizeForCompare(source);
}

function koreanFieldPasses(text: string): boolean {
  if (!text) return true;
  return HANGUL_PATTERN.test(text);
}

function spanishFieldPasses(text: string, englishSource: string): boolean {
  if (!text) return true;
  if (SPANISH_SIGNAL_PATTERN.test(text) || SPANISH_DIACRITIC_PATTERN.test(text)) return true;
  // No explicit Spanish signal or diacritic. Rather than false-reject short
  // valid Spanish (e.g. "2 cafés" without the diacritic hitting, or a short
  // phrase using none of the signal words), fall back to a meaningful-
  // difference check against the English field. When in doubt (no English
  // source to compare against), keep the field.
  if (!englishSource) return true;
  return isMeaningfullyDifferent(text, englishSource);
}

function withinLength(text: string, max: number): boolean {
  return text.length <= max;
}

/**
 * Applies deterministic pass/fail checks to each of the six translation
 * fields and blanks (sets to "") any field that fails. Never rejects the
 * whole result — a failing field just falls back to English client-side.
 */
export function applyDealTranslationOutputGate(
  fields: DealTranslationGateFields,
): DealTranslationGateOutcome {
  const next: DealTranslationGateFields = { ...fields };
  const blankedFields: string[] = [];

  const blank = (key: keyof DealTranslationGateFields) => {
    if (next[key]) {
      next[key] = "";
      blankedFields.push(key);
    }
  };

  // Language checks: Korean fields must contain Hangul, Spanish fields must
  // show a Spanish signal/diacritic or differ meaningfully from English.
  if (!koreanFieldPasses(next.title_ko)) blank("title_ko");
  if (!koreanFieldPasses(next.description_ko)) blank("description_ko");
  if (!spanishFieldPasses(next.title_es, next.title_en)) blank("title_es");
  if (!spanishFieldPasses(next.description_es, next.description_en)) blank("description_es");

  // Banned BOGO shorthand is disallowed in any field, any language.
  (Object.keys(next) as (keyof DealTranslationGateFields)[]).forEach((key) => {
    if (next[key] && hasBannedShorthand(next[key])) blank(key);
  });

  // Length caps, mirroring conservative mobile-card budgets.
  (["title_en", "title_es", "title_ko"] as const).forEach((key) => {
    if (next[key] && !withinLength(next[key], DEAL_TRANSLATION_TITLE_MAX_LENGTH)) blank(key);
  });
  (["description_en", "description_es", "description_ko"] as const).forEach((key) => {
    if (next[key] && !withinLength(next[key], DEAL_TRANSLATION_DESCRIPTION_MAX_LENGTH)) blank(key);
  });

  return { fields: next, blankedFields };
}
