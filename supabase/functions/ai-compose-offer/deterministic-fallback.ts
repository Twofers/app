// Deterministic (non-AI) fallback for ai-compose-offer, gated behind
// AI_COMPOSE_FALLBACK_ENABLED. Kept dependency-free (besides the shared
// validateComposeOutput gate) so it can be unit-tested from vitest without any
// Deno/edge runtime, mirroring the design of validate-output.ts.
//
// PURPOSE: when the live AI call throws, or its output (even after one repair
// re-ask) still fails validateComposeOutput, the merchant otherwise dead-ends
// on a 502 with nothing to work from (F1, first-deal-ai-quality-harness,
// 2026-07-20). This module attempts a best-effort, keyword-driven parse of the
// merchant's own typed/spoken hint into ONE of the three deal shapes Twofer
// allows (see index.ts systemPrompt's DEAL QUALITY section: something free, a
// same-item BOGO, or 40%+ off) and builds a minimal, fact-only compose_offer
// response from it. It NEVER invents a deal: any input that doesn't clearly
// describe one of those three shapes — including a real but sub-40% discount —
// returns null so the caller preserves the existing 502 exactly.
//
// The constructed output is run back through the SAME validateComposeOutput
// gate used for AI output. That is deliberate, not belt-and-suspenders: this
// parser is a blunt keyword/word-overlap tool and can echo merchant-typed text
// (e.g. a stray "bogo" inside a longer item phrase) straight into the output.
// validateComposeOutput is the single source of truth for "is this a safe,
// strong, on-brand deal" and this module leans on it rather than duplicating
// its rules.

import {
  COMPOSE_CTA_MAX_CHARS,
  COMPOSE_HEADLINE_MAX_CHARS,
  COMPOSE_SUBHEADLINE_MAX_CHARS,
  validateComposeOutput,
} from "./validate-output.ts";

/** Structural subset of ai-compose-offer/index.ts's ComposeMenuItem — only what fuzzy-matching needs. */
export type DeterministicFallbackMenuItem = {
  name: string;
  price_text?: string | null;
};

export type DeterministicOfferKind =
  | "buy_one_get_one_free"
  | "free_item_with_purchase"
  | "percent_off_item";

export type ParsedDeterministicOffer = {
  kind: DeterministicOfferKind;
  /** Required-purchase / discounted item (bogo + percent_off), or the buy-side item (free-item). */
  itemName: string;
  /** free_item_with_purchase only: the free reward item. */
  rewardItemName?: string;
  /** percent_off_item only: the discount percentage, already confirmed >= 40 and <= 100. */
  percent?: number;
  /** True when itemName resolved via a menu word-overlap match rather than raw hint text. */
  menuMatched: boolean;
  /** The matched menu item's price_text, when itemName came from a menu match and one was on file. Never invented. */
  priceText: string | null;
};

export const DETERMINISTIC_FALLBACK_RECOMMENDATION_REASON =
  "AI was unavailable; built from your text — please review.";

export type DeterministicComposeFallback = {
  recommended_offer: { offer_type: string; item_name: string; display_offer: string };
  ad_variants: Record<string, unknown>[];
  low_confidence: true;
  recommendation_reason: string;
  detected_items: string[];
};

// ---------------------------------------------------------------------------
// Text helpers (small, local versions in the style of lib/ai-revision-fallback-copy.ts —
// not imported from there, since that file's helpers are tuned for DealOfferContract's
// richer fact model and this module is deliberately smaller and dependency-free).
// ---------------------------------------------------------------------------

function cleanText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeForMatch(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9%\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsOf(value: string): string[] {
  const normalized = normalizeForMatch(value);
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function itemPhraseLower(value: string | null | undefined): string {
  return cleanText(value).toLowerCase();
}

function itemPhraseCap(value: string | null | undefined): string {
  const lower = itemPhraseLower(value);
  return lower ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : "";
}

function articleFor(value: string): "a" | "an" {
  return /^[aeiou]/i.test(cleanText(value)) ? "an" : "a";
}

/** Truncates to `max` chars on a word boundary where reasonable, matching validate-output.ts's limits. */
function compact(value: string, max: number): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  const clipped = text.slice(0, max + 1);
  const lastSpace = clipped.search(/\s+\S*$/);
  if (lastSpace > Math.max(10, Math.floor(max * 0.6))) return clipped.slice(0, lastSpace).trimEnd();
  return text.slice(0, max).trimEnd();
}

/** Real price text carried from a menu-matched item only — never invented, and capped to something sentence-sized. */
function priceSuffix(priceText: string | null | undefined): string {
  const text = cleanText(priceText);
  if (!text || text.length > 20 || text.includes("%")) return "";
  return ` (regularly ${text})`;
}

// ---------------------------------------------------------------------------
// Offer-type keyword detection
// ---------------------------------------------------------------------------

const BOGO_PATTERN = /\bbogo\b|\bbuy\s*one\s*get\s*one\b|\b2\s*for\s*1\b|\btwo\s*for\s*one\b|\bb1g1\b/i;
const PERCENT_OFF_PATTERN = /(\d{1,3})\s*%\s*off/i;
const FREE_WITH_PATTERN = /\bfree\s+(.+?)\s+with\s+(.+)/i;
const COMES_WITH_FREE_PATTERN = /(.+?)\s+comes\s+with\s+(?:a\s+)?free\s+(.+)/i;

/** Only removes the FIRST matched span — a second, incidental keyword occurrence elsewhere in the
 *  hint (e.g. a merchant-chosen item name that itself contains "bogo") is left alone on purpose. If
 *  it lands in the built item name, validateComposeOutput's banned-term scan is what catches it. */
function stripFirstMatch(text: string, pattern: RegExp): string {
  return text.replace(pattern, " ");
}

// Generic connector / offer-mechanic words only. Deliberately does NOT include offer-keyword
// tokens like "bogo" or "b1g1" — those are removed only via stripFirstMatch above, so a second,
// incidental occurrence survives into the candidate item name (see module doc comment).
const FILLER_WORDS = new Set([
  "a", "an", "the", "any", "one", "of", "your", "choice",
  "get", "gets", "getting", "buy", "buys", "buying",
  "off", "with", "comes", "come", "free",
  "deal", "deals", "special", "specials", "offer", "offers",
  "on", "for", "and", "plus", "today", "only", "new",
]);

function isFillerWord(word: string): boolean {
  return FILLER_WORDS.has(word) || /^\d+%?$/.test(word);
}

/** Longest contiguous run of non-filler words — "the longest cleaned noun-ish phrase from the hint". */
function longestNounishPhrase(text: string): string {
  const words = wordsOf(text);
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i <= words.length; i += 1) {
    const word = i < words.length ? words[i] : null;
    if (word && !isFillerWord(word)) {
      if (curStart === -1) curStart = i;
      curLen += 1;
    } else {
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  return bestLen > 0 ? words.slice(bestStart, bestStart + bestLen).join(" ") : "";
}

const LEADING_DETERMINERS = /^(?:a|an|any|the|one|your)\s+/i;

function cleanCapturedPhrase(raw: string): string {
  const trimmedPunct = cleanText(raw).replace(/[.,;:!?]+$/g, "");
  return cleanText(trimmedPunct.replace(LEADING_DETERMINERS, ""));
}

/**
 * Best word-overlap match between hint words and the business's own menu item
 * names — mirrors matchPosterGroundingMenuItem's shape (lib/poster/posterCopy.ts):
 * require >= 1 shared word, prefer the highest overlap, tie-break to the
 * shorter name. Reimplemented locally rather than imported so this module has
 * no dependency beyond validate-output.ts.
 */
function fuzzyMatchMenuItem(
  hintWords: readonly string[],
  menuItems: readonly DeterministicFallbackMenuItem[],
): DeterministicFallbackMenuItem | null {
  if (hintWords.length === 0 || menuItems.length === 0) return null;
  const wordSet = new Set(hintWords);
  let best: DeterministicFallbackMenuItem | null = null;
  let bestScore = 0;
  for (const item of menuItems) {
    const name = cleanText(item.name);
    if (!name) continue;
    const nameWords = wordsOf(name);
    if (nameWords.length === 0) continue;
    const overlap = nameWords.filter((word) => wordSet.has(word)).length;
    if (overlap === 0) continue;
    if (overlap > bestScore || (overlap === bestScore && best && name.length < cleanText(best.name).length)) {
      bestScore = overlap;
      best = item;
    }
  }
  return best;
}

type ResolvedItem = { name: string; menuMatched: boolean; priceText: string | null };

/** For bogo/percent-off: search the post-keyword-strip remainder, but menu-match against the FULL hint. */
function resolveItemFromRemainder(
  remainder: string,
  fullHintWords: readonly string[],
  menuItems: readonly DeterministicFallbackMenuItem[],
): ResolvedItem | null {
  const match = fuzzyMatchMenuItem(fullHintWords, menuItems);
  if (match) return { name: cleanText(match.name), menuMatched: true, priceText: cleanText(match.price_text) || null };
  const phrase = longestNounishPhrase(remainder);
  return phrase ? { name: phrase, menuMatched: false, priceText: null } : null;
}

/** For free-item-with-purchase: an explicit captured phrase (e.g. "any latte") rather than a search blob. */
function resolveItemFromPhrase(
  raw: string,
  menuItems: readonly DeterministicFallbackMenuItem[],
): ResolvedItem | null {
  const match = fuzzyMatchMenuItem(wordsOf(raw), menuItems);
  if (match) return { name: cleanText(match.name), menuMatched: true, priceText: cleanText(match.price_text) || null };
  const cleaned = cleanCapturedPhrase(raw);
  return cleaned ? { name: cleaned, menuMatched: false, priceText: null } : null;
}

/**
 * Pure keyword + menu-fuzzy-match parser. Returns null whenever the hint does
 * not clearly describe one of Twofer's three allowed strong-deal shapes, or
 * clearly describes a WEAK one (sub-40% off) — "never invent a weak/ambiguous
 * deal" is enforced here, before any copy gets built.
 */
export function parseDeterministicOfferHint(
  hintText: string,
  menuItems: readonly DeterministicFallbackMenuItem[] = [],
): ParsedDeterministicOffer | null {
  const hint = cleanText(hintText);
  if (!hint) return null;
  const fullWords = wordsOf(hint);

  if (BOGO_PATTERN.test(hint)) {
    const remainder = stripFirstMatch(hint, BOGO_PATTERN);
    const item = resolveItemFromRemainder(remainder, fullWords, menuItems);
    if (!item) return null;
    return {
      kind: "buy_one_get_one_free",
      itemName: item.name,
      menuMatched: item.menuMatched,
      priceText: item.priceText,
    };
  }

  const freeWith = FREE_WITH_PATTERN.exec(hint);
  const comesWithFree = freeWith ? null : COMES_WITH_FREE_PATTERN.exec(hint);
  if (freeWith || comesWithFree) {
    const rewardRaw = freeWith ? freeWith[1] : comesWithFree![2];
    const buyRaw = freeWith ? freeWith[2] : comesWithFree![1];
    const buyItem = resolveItemFromPhrase(buyRaw, menuItems);
    const rewardItem = resolveItemFromPhrase(rewardRaw, menuItems);
    if (!buyItem || !rewardItem) return null;
    return {
      kind: "free_item_with_purchase",
      itemName: buyItem.name,
      rewardItemName: rewardItem.name,
      menuMatched: buyItem.menuMatched || rewardItem.menuMatched,
      priceText: buyItem.priceText,
    };
  }

  const percentMatch = PERCENT_OFF_PATTERN.exec(hint);
  if (percentMatch) {
    const value = Number(percentMatch[1]);
    // Anything below the 40% strong-deal floor is a real but WEAK deal — never upgrade or
    // invent around it. Above 100 is nonsensical input, not a deal. Both give up (null).
    if (!Number.isFinite(value) || value < 40 || value > 100) return null;
    const remainder = stripFirstMatch(hint, PERCENT_OFF_PATTERN);
    const item = resolveItemFromRemainder(remainder, fullWords, menuItems);
    if (!item) return null;
    return {
      kind: "percent_off_item",
      itemName: item.name,
      percent: value,
      menuMatched: item.menuMatched,
      priceText: item.priceText,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Copy construction — plain, fact-only sentences. No hype, no invented claims;
// es/ko use simple fixed templates with the parsed item(s) dropped in, in the
// spirit of lib/localization-glossary.ts's plain term substitutions (deal/free/
// claim all match that glossary) rather than the native-counter-reviewed
// machinery in lib/localized-offer-renderer.ts, which is out of scope here.
// ---------------------------------------------------------------------------

function buildDisplayOffer(parsed: ParsedDeterministicOffer): string {
  const item = itemPhraseLower(parsed.itemName);
  const suffix = priceSuffix(parsed.priceText);
  if (parsed.kind === "buy_one_get_one_free") {
    return `Buy one ${item}, get one free.${suffix}`;
  }
  if (parsed.kind === "free_item_with_purchase") {
    const reward = itemPhraseLower(parsed.rewardItemName);
    return `Buy ${articleFor(item)} ${item} and get ${articleFor(reward)} ${reward} free.${suffix}`;
  }
  const pct = parsed.percent ?? 40;
  return `Save ${pct}% on one ${item}.${suffix}`;
}

function buildVariants(parsed: ParsedDeterministicOffer): Record<string, unknown>[] {
  const item = itemPhraseLower(parsed.itemName);
  const itemCap = itemPhraseCap(parsed.itemName);

  let headlineEn: [string, string];
  let headlineEs: [string, string];
  let headlineKo: [string, string];

  if (parsed.kind === "buy_one_get_one_free") {
    headlineEn = [`Buy one ${item}, get one free`, `${itemCap}: buy one, get one free`];
    // "Compra 1 X, llevate ..." sidesteps un/una gender agreement for an arbitrary item noun.
    headlineEs = [`Compra 1 ${item}, llevate otro gratis`, `Compra 1 ${item}, llevate 1 gratis`];
    headlineKo = [`${item} 하나 사면 하나 무료`, `${item} 1개 사면 1개 무료`];
  } else if (parsed.kind === "free_item_with_purchase") {
    const reward = itemPhraseLower(parsed.rewardItemName);
    const rewardCap = itemPhraseCap(parsed.rewardItemName);
    headlineEn = [`Buy ${item}, get ${reward} free`, `${rewardCap} free with ${item}`];
    headlineEs = [`Compra ${item}, llevate ${reward} gratis`, `${rewardCap} gratis con ${item}`];
    headlineKo = [`${item} 구매 시 ${reward} 무료`, `${item} 사면 ${reward} 무료`];
  } else {
    const pct = String(parsed.percent ?? 40);
    headlineEn = [`Save ${pct}% on one ${item}`, `${itemCap} at ${pct}% off`];
    headlineEs = [`Ahorra ${pct}% en 1 ${item}`, `${itemCap} con ${pct}% de descuento`];
    headlineKo = [`${item} ${pct}% 할인`, `${item} ${pct}% 세일`];
  }

  // Generic, process-only lines — never a merchant-specific claim we can't verify from parsed facts.
  const subheadlineEn: [string, string] = ["Show this offer when you order.", "Present this deal at checkout."];
  const subheadlineEs: [string, string] = ["Muestra esta oferta al pedir.", "Presenta la oferta al pagar."];
  const subheadlineKo: [string, string] = ["주문할 때 이 딜을 보여주세요.", "계산할 때 이 딜을 제시하세요."];
  // "Claim" matches lib/localization-glossary.ts's claim term (es: reclamar, ko: 받기) exactly.
  const ctaEn: [string, string] = ["Claim", "Claim deal"];
  const ctaEs: [string, string] = ["Reclamar", "Reclamar oferta"];
  const ctaKo: [string, string] = ["받기", "지금 받기"];
  const rationale: [string, string] = [
    "States the offer exactly as described, with no added claims.",
    "A shorter restatement of the same offer.",
  ];

  const build = (i: 0 | 1): Record<string, unknown> => ({
    variant_id: i === 0 ? "A" : "B",
    headline_en: compact(headlineEn[i], COMPOSE_HEADLINE_MAX_CHARS),
    headline_es: compact(headlineEs[i], COMPOSE_HEADLINE_MAX_CHARS),
    headline_ko: compact(headlineKo[i], COMPOSE_HEADLINE_MAX_CHARS),
    subheadline_en: compact(subheadlineEn[i], COMPOSE_SUBHEADLINE_MAX_CHARS),
    subheadline_es: compact(subheadlineEs[i], COMPOSE_SUBHEADLINE_MAX_CHARS),
    subheadline_ko: compact(subheadlineKo[i], COMPOSE_SUBHEADLINE_MAX_CHARS),
    cta_en: compact(ctaEn[i], COMPOSE_CTA_MAX_CHARS),
    cta_es: compact(ctaEs[i], COMPOSE_CTA_MAX_CHARS),
    cta_ko: compact(ctaKo[i], COMPOSE_CTA_MAX_CHARS),
    style_label: i === 0 ? "plain_facts" : "plain_facts_short",
    rationale: rationale[i],
    visual_direction: "Simple text-forward layout; no photo required.",
  });

  return [build(0), build(1)];
}

/**
 * Maps this module's internal offer-kind vocabulary onto ai-compose-offer's
 * fixed OFFER_TYPES allow-list (index.ts / validate-output.ts). That allow-list
 * has no percent-off-specific entry — the compose system prompt still tells the
 * model 40%+ off is an acceptable strong deal, but recommended_offer.offer_type
 * only ever names a *mechanic* shape (same-item BOGO, second-item-half-off BOGO,
 * free add-on, or generic bundle). "simple_bundle_offer" is the closest existing
 * generic bucket for a plain single-item percent discount — nothing in the
 * allow-list names that mechanic precisely. Documented judgment call.
 */
const OFFER_TYPE_BY_KIND: Record<DeterministicOfferKind, string> = {
  buy_one_get_one_free: "bogo_same_item",
  free_item_with_purchase: "free_add_on_with_purchase",
  percent_off_item: "simple_bundle_offer",
};

/**
 * Parses the hint and, on a match, builds a full compose_offer-shaped result —
 * then runs it back through validateComposeOutput (the same gate live AI output
 * must pass). Returns null whenever the hint doesn't describe an allowed deal
 * OR the constructed copy fails its own validation (e.g. a stray banned word
 * echoed from the merchant's text); callers should treat null exactly like "no
 * fallback available" and preserve the existing 502.
 */
export function buildDeterministicComposeFallback(params: {
  hintText: string;
  menuItems?: readonly DeterministicFallbackMenuItem[];
  offerTypes: readonly string[];
}): DeterministicComposeFallback | null {
  const parsed = parseDeterministicOfferHint(params.hintText, params.menuItems ?? []);
  if (!parsed) return null;

  const offerType = OFFER_TYPE_BY_KIND[parsed.kind];
  if (!params.offerTypes.includes(offerType)) return null;

  const offer = {
    offer_type: offerType,
    item_name: itemPhraseCap(parsed.itemName),
    display_offer: buildDisplayOffer(parsed),
  };
  const variants = buildVariants(parsed);

  const validation = validateComposeOutput({ offerTypes: params.offerTypes, offer, variants });
  if (!validation.ok) return null;

  const detected_items = parsed.rewardItemName
    ? [itemPhraseCap(parsed.itemName), itemPhraseCap(parsed.rewardItemName)]
    : [itemPhraseCap(parsed.itemName)];

  return {
    recommended_offer: offer,
    ad_variants: variants,
    low_confidence: true,
    recommendation_reason: DETERMINISTIC_FALLBACK_RECOMMENDATION_REASON,
    detected_items,
  };
}
