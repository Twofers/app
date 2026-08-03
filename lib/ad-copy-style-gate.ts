import {
  AD_COPY_AI_TONE_PATTERNS,
  AD_COPY_FORBIDDEN_PATTERNS,
  AD_COPY_GENERIC_PHRASE_PATTERNS,
  AD_COPY_HYPE_WORD_PATTERN,
  AD_COPY_INSTRUCTION_LEAK_PATTERNS,
  AD_COPY_LOCAL_CLICHE_PATTERNS,
} from "./ad-language-policy.ts";

export type AdSpecV3TextField =
  | "displayHook"
  | "offerLine"
  | "supportingLine"
  | "cta"
  | "pushTitle"
  | "pushBody"
  | "socialCaption";

export type AdSpecV3TextProvenance =
  | "ai_generated"
  | "deterministic"
  | "merchant_typed"
  | "merchant_edited";

export type AdCopyStyleGateReason =
  | "FORBIDDEN_AI_PHRASE"
  | "GENERIC_MARKETING_PHRASE"
  | "AI_TONE_PHRASE"
  | "VAGUE_LOCAL_CLICHE"
  | "HYPE_WITHOUT_SPECIFICITY"
  | "BARE_SPECIFIC_TERM"
  | "WEAK_TRY_OUR_PHRASE"
  | "AWKWARD_ARTICLE_QUANTIFIER"
  | "INSTRUCTION_LEAK_PHRASE"
  | "TRUNCATED_FRAGMENT"
  | "QUANTITY_ARTICLE_COLLISION"
  | "ARTICLE_SOUND_DISAGREEMENT"
  | "TOO_MANY_EXCLAMATIONS"
  | "EMOJI_IN_AI_COPY";

export type AdCopyStyleGateInput = {
  copy: Partial<Record<AdSpecV3TextField, string>>;
  provenance: Partial<Record<AdSpecV3TextField, AdSpecV3TextProvenance>>;
  requiredSpecificTerms?: string[];
};

export type AdCopyStyleFieldFailure = {
  field: AdSpecV3TextField;
  provenance: AdSpecV3TextProvenance;
  reasons: AdCopyStyleGateReason[];
};

export type AdCopyStyleGateResult = {
  ok: boolean;
  failures: AdCopyStyleFieldFailure[];
  bypassedFields: AdSpecV3TextField[];
};

export type StyleSafeCopyCandidate<TCopy extends Partial<Record<AdSpecV3TextField, string>>> = {
  copy: TCopy;
  provenance: Partial<Record<AdSpecV3TextField, AdSpecV3TextProvenance>>;
};

export type StyleSafeCopySelection<TCopy extends Partial<Record<AdSpecV3TextField, string>>> = {
  copy: TCopy;
  gate: AdCopyStyleGateResult;
  selectedIndex: number | null;
  usedFallback: boolean;
};

const AI_CHECKED_FIELDS: AdSpecV3TextField[] = [
  "displayHook",
  "supportingLine",
  "cta",
  "pushTitle",
  "pushBody",
  "socialCaption",
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSpecificTerm(text: string, requiredSpecificTerms: string[] | undefined): boolean {
  const lower = text.toLowerCase();
  const terms = (requiredSpecificTerms ?? []).map(normalizeTerm).filter((term) => term.length >= 3);
  return terms.length === 0 || terms.some((term) => lower.includes(term));
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isBareSpecificTerm(text: string, requiredSpecificTerms: string[] | undefined): boolean {
  const normalizedText = normalizeTerm(text).replace(/^(?:a|an|any|the)\s+/, "");
  if (!normalizedText) return false;
  const terms = (requiredSpecificTerms ?? [])
    .map((term) => normalizeTerm(term).replace(/^(?:a|an|any|the)\s+/, ""))
    .filter((term) => term.length >= 3);
  return terms.some((term) => normalizedText === term);
}

function isWeakTryOurPhrase(text: string): boolean {
  return /^try\s+(?:our|the)\b/i.test(text.trim());
}

/**
 * A headline opening with a coordinating conjunction is a fragment — the head noun
 * was dropped. Observed live: the item "Haircut and fade" produced the headline
 * "AND FADE SAVINGS", which is not a length clamp (24 chars fits the 28-char poster
 * limit) but a broken sentence on a paid ad.
 *
 * Articles and prepositions ("the ...", "a ...", "with ...") are legitimate headline
 * openers and are deliberately NOT matched — only conjunctions, which never validly
 * begin a headline.
 *
 * Expects text normalized to lowercase words; callers that hold raw copy should pass
 * it through their own normalizer first (the regex is case-insensitive regardless).
 */
export function startsWithDanglingConnector(text: string): boolean {
  return /^\s*(?:and|or|but|plus)\b/i.test(text ?? "");
}

/**
 * "<item> savings|deal|special|offer" is the model's default template. It carries no
 * hook and merely restates the mechanic the offer block already shows. One generation
 * batch produced it three times in a row ("Loaded Nachos Savings", "Acai Bowl
 * Savings", "Birria Tacos Savings").
 *
 * Deliberately pattern-level: the repo forbids fixing copy quality by special-casing
 * individual item names. Requires at least one word before the value noun so a
 * headline that merely *contains* "deal" is not caught.
 */
export function isFormulaicValueHeadline(text: string): boolean {
  const collapsed = (text ?? "").trim().replace(/\s+/g, " ");
  if (!collapsed) return false;
  return /^[\p{L}\p{N}%+][\p{L}\p{N}%+\s'’-]{0,44}\s(?:savings|deals?|specials?|offers?)$/iu.test(collapsed);
}

function hasAwkwardArticleQuantifier(text: string): boolean {
  return /\b(?:a|an|the|our|your)\s+any\b/i.test(text);
}

/**
 * A line ending on a bare function word is a truncated fragment — observed live:
 * the headline "Coffee and a free to" shipped as AI_VALIDATED (2026-07-26 corpus).
 * Truncated text characteristically lacks terminal punctuation, so a sentence
 * that properly ends in a period never matches.
 */
export function endsInDanglingFunctionWord(text: string): boolean {
  return /\b(?:a|an|the|and|or|with|for|to|of|plus)\s*$/i.test((text ?? "").trim());
}

/**
 * A count word directly followed by an article is broken English produced by
 * pasting an article-bearing item name after a quantity — observed live: "40%
 * off one THE SERGEANT'S STRIPES". Punctuation between the words ("buy one,
 * the second is free") does not match. Pattern-level by design; no item name
 * is special-cased.
 */
export function hasQuantityArticleCollision(text: string): boolean {
  return /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:a|an|the)\b/i.test(text ?? "");
}

/** Silent-h nouns take "an" despite the consonant letter. Mirrors articleFor(). */
const SILENT_H_NOUN = /^(?:honest|honou?r|hour|heir|herb)/i;
/**
 * Vowel letters that open on a consonant SOUND, so they take "a": the "yoo" of
 * "a user"/"a unique blend", the "wuh" of "a one-time deal", the "yoo" of
 * "a euro". The first two branches mirror articleFor(); "eu"/"one"/"once" are
 * additions the generators do not have, kept here so correct AI copy is never
 * thrown away for a case the deterministic writer happens to get wrong.
 */
const SOUNDED_CONSONANT_VOWEL = /^(?:uni(?:[^nmd]|$)|user|useful|usual|utensil|ubiquit|u[bcfhjkqrst][a-z]|eu|ewe|one\b|once\b)/i;

/**
 * Letter-by-letter initialisms ("an XL", "a FAQ") are pronounced by letter name,
 * which no spelling rule predicts. Treated as unknown rather than guessed at.
 */
function isLikelyInitialism(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 && letters.length <= 4 && letters === letters.toUpperCase();
}

/** The article this word requires, or null when English genuinely allows either. */
function expectedArticleFor(word: string): "a" | "an" | null {
  if (!word || isLikelyInitialism(word)) return null;
  if (SILENT_H_NOUN.test(word)) return "an";
  if (SOUNDED_CONSONANT_VOWEL.test(word)) return "a";
  if (/^[aeiou]/i.test(word)) return "an";
  // "an historic" is a live stylistic variant, so h-words are never flagged.
  if (/^h/i.test(word)) return null;
  return "a";
}

/**
 * "a" against a vowel sound, or "an" against a consonant one — observed live on
 * a published poster as the headline "Half off a espresso" (2026-08-03, Cedar &
 * Bean Cafe). The deterministic writers all pick the article with articleFor(),
 * so only AI-authored copy reaches the gate carrying this mistake. Pattern-level
 * by design; no item name is special-cased, and every genuinely ambiguous word
 * class (initialisms, sounded-vowel openings, non-silent h) is skipped so a
 * correct headline is never discarded.
 */
export function hasArticleSoundDisagreement(text: string): boolean {
  const matches = (text ?? "").matchAll(/\b(an?)\s+([\p{L}][\p{L}'’-]*)/giu);
  for (const match of matches) {
    const expected = expectedArticleFor(match[2]);
    if (expected && expected !== match[1].toLowerCase()) return true;
  }
  return false;
}

function shouldBypassStyleGate(provenance: AdSpecV3TextProvenance): boolean {
  return provenance === "merchant_typed" || provenance === "merchant_edited";
}

function reasonsForField(text: string, requiredSpecificTerms: string[] | undefined): AdCopyStyleGateReason[] {
  const reasons: AdCopyStyleGateReason[] = [];
  if (!text) return reasons;
  if (hasAnyPattern(text, [...AD_COPY_FORBIDDEN_PATTERNS])) reasons.push("FORBIDDEN_AI_PHRASE");
  if (hasAnyPattern(text, [...AD_COPY_GENERIC_PHRASE_PATTERNS])) reasons.push("GENERIC_MARKETING_PHRASE");
  if (hasAnyPattern(text, [...AD_COPY_AI_TONE_PATTERNS])) reasons.push("AI_TONE_PHRASE");
  if (hasAnyPattern(text, [...AD_COPY_LOCAL_CLICHE_PATTERNS])) reasons.push("VAGUE_LOCAL_CLICHE");
  if (isBareSpecificTerm(text, requiredSpecificTerms)) reasons.push("BARE_SPECIFIC_TERM");
  if (isWeakTryOurPhrase(text)) reasons.push("WEAK_TRY_OUR_PHRASE");
  if (hasAwkwardArticleQuantifier(text)) reasons.push("AWKWARD_ARTICLE_QUANTIFIER");
  if (hasAnyPattern(text, [...AD_COPY_INSTRUCTION_LEAK_PATTERNS])) reasons.push("INSTRUCTION_LEAK_PHRASE");
  if (endsInDanglingFunctionWord(text)) reasons.push("TRUNCATED_FRAGMENT");
  if (hasQuantityArticleCollision(text)) reasons.push("QUANTITY_ARTICLE_COLLISION");
  if (hasArticleSoundDisagreement(text)) reasons.push("ARTICLE_SOUND_DISAGREEMENT");
  if (AD_COPY_HYPE_WORD_PATTERN.test(text) && !hasSpecificTerm(text, requiredSpecificTerms)) {
    reasons.push("HYPE_WITHOUT_SPECIFICITY");
  }
  if ((text.match(/!/g) ?? []).length > 1) reasons.push("TOO_MANY_EXCLAMATIONS");
  if (EMOJI_RE.test(text)) reasons.push("EMOJI_IN_AI_COPY");
  return reasons;
}

export function evaluateAdCopyStyleGate(input: AdCopyStyleGateInput): AdCopyStyleGateResult {
  const failures: AdCopyStyleFieldFailure[] = [];
  const bypassedFields: AdSpecV3TextField[] = [];

  for (const field of AI_CHECKED_FIELDS) {
    const provenance = input.provenance[field] ?? "ai_generated";
    if (shouldBypassStyleGate(provenance)) {
      bypassedFields.push(field);
      continue;
    }

    const reasons = reasonsForField(cleanText(input.copy[field]), input.requiredSpecificTerms);
    if (reasons.length > 0) {
      failures.push({ field, provenance, reasons });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    bypassedFields,
  };
}

export function selectStyleSafeCopyCandidate<TCopy extends Partial<Record<AdSpecV3TextField, string>>>(
  candidates: Array<StyleSafeCopyCandidate<TCopy>>,
  deterministicFallback: StyleSafeCopyCandidate<TCopy>,
  requiredSpecificTerms?: string[],
): StyleSafeCopySelection<TCopy> {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const gate = evaluateAdCopyStyleGate({
      copy: candidate.copy,
      provenance: candidate.provenance,
      requiredSpecificTerms,
    });
    if (gate.ok) {
      return { copy: candidate.copy, gate, selectedIndex: index, usedFallback: false };
    }
  }

  const fallbackGate = evaluateAdCopyStyleGate({
    copy: deterministicFallback.copy,
    provenance: deterministicFallback.provenance,
    requiredSpecificTerms,
  });
  return { copy: deterministicFallback.copy, gate: fallbackGate, selectedIndex: null, usedFallback: true };
}
