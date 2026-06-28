import {
  AD_COPY_BOGO_SHORTHAND_PATTERNS,
  AD_COPY_FORBIDDEN_PATTERNS,
  matchesAdCopyPattern,
} from "./ad-language-policy.ts";
import type {
  AdTranslationQaHardFailReason,
  AdTranslationQaResult,
  AdTranslationQaScores,
  SourceAdCreative,
} from "./ad-localization-schema.ts";
import {
  SOURCE_CREATIVE_LOCALE_POLICIES,
} from "./ad-source-locale-policy.ts";
import type { OfferDefinitionV1 } from "./offer-definition.ts";
import type { SupportedLocale } from "./supported-locales.ts";

export const AD_TRANSLATION_QA_VERSION = "ad-translation-qa-v1";

export const AD_TRANSLATION_FIELD_LIMITS = {
  headline: 72,
  supportingCopy: 160,
  imageAltText: 140,
} as const;

const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
const LATIN_WORD_PATTERN = /[A-Za-z\u00c0-\u024f]+/g;
const ENGLISH_SIGNAL_PATTERN =
  /\b(?:and|available|buy|come|comes|deal|free|get|local|offer|reward|today|with|your)\b/i;
const SPANISH_SIGNAL_PATTERN =
  /\b(?:al|beneficio|comprar|con|disponible|en|gratis|hoy|local|oferta|para|recibe|recibes|tu)\b/i;
const SPANISH_DIACRITIC_PATTERN = /[áéíóúñüÁÉÍÓÚÑÜ¿¡]/;
const UNICODE_DIGIT_PATTERN = /\d+(?:[.,:]\d+)*/g;

const UNSUPPORTED_CLAIM_PATTERNS = [
  /\b(?:award[- ]winning|best|cheapest|fastest|guaranteed|number\s*1|#\s*1|rated)\b/i,
  /\b(?:gluten[- ]free|keto|organic|sugar[- ]free|vegan|vegetarian)\b/i,
  /\b(?:freshly baked|freshly roasted|made from scratch|homemade)\b/i,
  /\b(?:el|la|los|las)\s+mejor(?:es)?\b/i,
  /\b(?:garantizado|garantizada|garantizados|garantizadas|orgánico|orgánica|orgánicos|orgánicas)\b/i,
] as const;

const SPANISH_UNNATURAL_PATTERNS = [
  /\b(?:buy|deal|free|reward|today with your)\b/i,
] as const;

const KOREAN_UNNATURAL_PATTERNS = [
  /\b(?:buy|deal|free|get|offer|reward|today|with your)\b/i,
] as const;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function creativeText(creative: SourceAdCreative | null | undefined): string {
  if (!creative) return "";
  return [
    creative.headline,
    creative.supportingCopy,
    creative.imageAltText,
  ].map(cleanText).filter(Boolean).join(" ");
}

function stripProtectedTerms(text: string, protectedTerms: readonly string[]): string {
  let stripped = text;
  for (const term of protectedTerms) {
    const clean = cleanText(term);
    if (!clean) continue;
    stripped = stripped.replace(new RegExp(escapeRegExp(clean), "gi"), " ");
  }
  return stripped.replace(/\s+/g, " ").trim();
}

function offerProtectedTerms(definition: OfferDefinitionV1): string[] {
  return [
    definition.merchantName,
    definition.locationName,
    ...definition.qualifyingItems.map((item) => item.displayName),
    ...definition.reward.displayNames,
  ].map(cleanText).filter(Boolean);
}

function allProtectedTerms(
  definition: OfferDefinitionV1,
  protectedTerms: readonly string[] | null | undefined,
): string[] {
  const out: string[] = [];
  for (const term of [...offerProtectedTerms(definition), ...(protectedTerms ?? [])]) {
    const clean = cleanText(term);
    if (clean && !out.some((existing) => existing.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out;
}

function sourceMentionedProtectedTerms(
  sourceCreative: SourceAdCreative,
  protectedTerms: readonly string[],
): string[] {
  const source = creativeText(sourceCreative);
  return protectedTerms.filter((term) => source.includes(term));
}

function numbersIn(value: string): string[] {
  return value.match(UNICODE_DIGIT_PATTERN) ?? [];
}

function removeBogoShorthand(value: string): string {
  let out = value;
  for (const pattern of AD_COPY_BOGO_SHORTHAND_PATTERNS) out = out.replace(pattern, " ");
  return out;
}

function allowedNumbers(sourceCreative: SourceAdCreative, definition: OfferDefinitionV1): string[] {
  const values = [
    ...numbersIn(creativeText(sourceCreative)),
    ...definition.qualifyingItems.map((item) => String(item.quantity)),
    String(definition.reward.quantity),
    String(definition.reward.discountPercent),
    definition.totalClaimLimit == null ? "" : String(definition.totalClaimLimit),
    ...numbersIn(definition.schedule.summary ?? ""),
    ...numbersIn(definition.canonicalOfferLine),
    ...numbersIn(definition.canonicalTermsLine),
  ].map(cleanText).filter(Boolean);
  return unique(values);
}

function hasUnexpectedNumber(
  targetCreative: SourceAdCreative,
  sourceCreative: SourceAdCreative,
  definition: OfferDefinitionV1,
): boolean {
  const allowed = new Set(allowedNumbers(sourceCreative, definition));
  return numbersIn(removeBogoShorthand(creativeText(targetCreative))).some((number) => !allowed.has(number));
}

function missingProtectedTerms(input: {
  sourceCreative: SourceAdCreative;
  targetCreative: SourceAdCreative;
  protectedTerms: readonly string[];
}): string[] {
  const required = sourceMentionedProtectedTerms(input.sourceCreative, input.protectedTerms);
  const target = creativeText(input.targetCreative);
  return required.filter((term) => !target.includes(term));
}

function targetLanguageFailure(
  locale: SupportedLocale,
  textWithoutProtected: string,
): AdTranslationQaHardFailReason | null {
  if (!textWithoutProtected) return "INCOMPLETE_FIELDS";
  if (locale === "ko-KR") return HANGUL_PATTERN.test(textWithoutProtected) ? null : "WRONG_LANGUAGE";
  if (HANGUL_PATTERN.test(textWithoutProtected)) return "WRONG_LANGUAGE";
  if (locale === "es-US") {
    return SPANISH_SIGNAL_PATTERN.test(textWithoutProtected) || SPANISH_DIACRITIC_PATTERN.test(textWithoutProtected)
      ? null
      : "WRONG_LANGUAGE";
  }
  if (SPANISH_SIGNAL_PATTERN.test(textWithoutProtected) && !ENGLISH_SIGNAL_PATTERN.test(textWithoutProtected)) {
    return "WRONG_LANGUAGE";
  }
  return null;
}

function unexpectedLanguageMixing(
  locale: SupportedLocale,
  textWithoutProtected: string,
): boolean {
  if (locale === "ko-KR") return matchesAdCopyPattern(textWithoutProtected, KOREAN_UNNATURAL_PATTERNS);
  if (locale === "es-US") return matchesAdCopyPattern(textWithoutProtected, SPANISH_UNNATURAL_PATTERNS);
  return HANGUL_PATTERN.test(textWithoutProtected);
}

function mobileLengthFailures(creative: SourceAdCreative): boolean {
  return cleanText(creative.headline).length > AD_TRANSLATION_FIELD_LIMITS.headline ||
    cleanText(creative.supportingCopy).length > AD_TRANSLATION_FIELD_LIMITS.supportingCopy ||
    cleanText(creative.imageAltText).length > AD_TRANSLATION_FIELD_LIMITS.imageAltText;
}

function incompleteFields(source: SourceAdCreative, target: SourceAdCreative): boolean {
  if (!cleanText(target.headline) || !cleanText(target.imageAltText)) return true;
  return Boolean(cleanText(source.supportingCopy)) && !cleanText(target.supportingCopy);
}

function bannedShorthand(locale: SupportedLocale, text: string): boolean {
  const localePolicy = SOURCE_CREATIVE_LOCALE_POLICIES[locale];
  if (matchesAdCopyPattern(text, AD_COPY_BOGO_SHORTHAND_PATTERNS)) return true;
  return localePolicy.bannedShorthand.some((phrase) =>
    new RegExp(`\\b${escapeRegExp(phrase).replace(/\\ /g, "\\s+")}\\b`, "i").test(text)
  );
}

function unsupportedClaim(text: string): boolean {
  return matchesAdCopyPattern(text, AD_COPY_FORBIDDEN_PATTERNS) ||
    matchesAdCopyPattern(text, UNSUPPORTED_CLAIM_PATTERNS);
}

function reasonFeedback(reason: AdTranslationQaHardFailReason): string {
  switch (reason) {
    case "WRONG_LANGUAGE":
      return "Target fields do not read as the requested target language.";
    case "OFFER_FACT_DRIFT":
      return "Target fields add numbers or mechanics not supported by the source offer facts.";
    case "UNSUPPORTED_CLAIM":
      return "Target fields include an unsupported marketing, quality, or dietary claim.";
    case "PROTECTED_TERM_CHANGED":
      return "A protected merchant or item term from the source creative is missing or changed.";
    case "BANNED_SHORTHAND":
      return "Target fields use banned BOGO shorthand.";
    case "MEANING_CHANGED":
      return "Target fields appear to change the source creative meaning.";
    case "MOBILE_COPY_TOO_LONG":
      return "Target fields are too long for the mobile card budget.";
    case "UNNATURAL_TARGET_LANGUAGE":
      return "Target fields contain unnatural or overly literal target-language phrasing.";
    case "INCOMPLETE_FIELDS":
      return "Target fields are incomplete.";
    case "UNEXPECTED_LANGUAGE_MIXING":
      return "Target fields mix languages beyond protected terms.";
  }
}

function decisionFor(reasons: readonly AdTranslationQaHardFailReason[]): AdTranslationQaResult["decision"] {
  if (reasons.length === 0) return "pass";
  if (reasons.some((reason) => reason === "OFFER_FACT_DRIFT" || reason === "UNSUPPORTED_CLAIM" || reason === "MEANING_CHANGED")) {
    return "block";
  }
  return "repair";
}

function score(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function scoresFor(reasons: readonly AdTranslationQaHardFailReason[]): AdTranslationQaScores {
  return {
    semanticParity: score(reasons.includes("MEANING_CHANGED") || reasons.includes("OFFER_FACT_DRIFT") ? 0.2 : 1),
    naturalness: score(reasons.includes("UNNATURAL_TARGET_LANGUAGE") || reasons.includes("WRONG_LANGUAGE") ? 0.35 : 1),
    merchantTone: score(reasons.includes("UNSUPPORTED_CLAIM") ? 0.45 : 1),
    clarity: score(reasons.includes("INCOMPLETE_FIELDS") ? 0.4 : 1),
    mobileReadability: score(reasons.includes("MOBILE_COPY_TOO_LONG") ? 0.35 : 1),
  };
}

export function validateAdTranscreationDeterministically(input: {
  sourceLocale: SupportedLocale;
  targetLocale: SupportedLocale;
  sourceCreative: SourceAdCreative;
  targetCreative: SourceAdCreative | null | undefined;
  offerDefinition: OfferDefinitionV1;
  protectedTerms?: readonly string[] | null;
}): AdTranslationQaResult {
  const targetCreative = input.targetCreative;
  if (!targetCreative) {
    const reasons: AdTranslationQaHardFailReason[] = ["INCOMPLETE_FIELDS"];
    return {
      locale: input.targetLocale,
      decision: "repair",
      hardFailReasons: reasons,
      scores: scoresFor(reasons),
      conciseFeedback: reasons.map(reasonFeedback),
    };
  }

  const protectedTerms = allProtectedTerms(input.offerDefinition, input.protectedTerms);
  const text = creativeText(targetCreative);
  const textWithoutProtected = stripProtectedTerms(text, protectedTerms);
  const reasons: AdTranslationQaHardFailReason[] = [];

  if (incompleteFields(input.sourceCreative, targetCreative)) reasons.push("INCOMPLETE_FIELDS");
  const languageFailure = targetLanguageFailure(input.targetLocale, textWithoutProtected);
  if (languageFailure) reasons.push(languageFailure);
  if (missingProtectedTerms({
    sourceCreative: input.sourceCreative,
    targetCreative,
    protectedTerms,
  }).length > 0) {
    reasons.push("PROTECTED_TERM_CHANGED");
  }
  if (bannedShorthand(input.targetLocale, text)) reasons.push("BANNED_SHORTHAND");
  if (unsupportedClaim(text)) reasons.push("UNSUPPORTED_CLAIM");
  if (hasUnexpectedNumber(targetCreative, input.sourceCreative, input.offerDefinition)) reasons.push("OFFER_FACT_DRIFT");
  if (mobileLengthFailures(targetCreative)) reasons.push("MOBILE_COPY_TOO_LONG");
  if (unexpectedLanguageMixing(input.targetLocale, textWithoutProtected)) reasons.push("UNEXPECTED_LANGUAGE_MIXING");

  const hardFailReasons = unique(reasons);
  return {
    locale: input.targetLocale,
    decision: decisionFor(hardFailReasons),
    hardFailReasons,
    scores: scoresFor(hardFailReasons),
    conciseFeedback: hardFailReasons.length ? hardFailReasons.map(reasonFeedback) : ["Deterministic localization checks passed."],
  };
}
