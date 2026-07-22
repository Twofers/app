import {
  resolveLocalizedOfferTerm,
  type LocalizedOfferTerm,
} from "../localized-offer-terms.ts";
import { renderLocalizedOfferBundleFromDefinition } from "../localized-offer-renderer.ts";
import {
  SUPPORTED_LOCALES,
  supportedLocaleOrDefault,
  type SupportedLocale,
} from "../supported-locales.ts";
import type { OfferDefinitionV1 } from "../offer-definition.ts";
import {
  assertPosterCopyPolicy,
  checkPosterTextFit,
  isGenericPosterKicker,
  POSTER_TEXT_LIMITS,
  sanitizePosterCopy,
  sanitizePosterText,
  scanPosterTextPolicy,
} from "./posterPolicy.ts";
import type { PosterTextFitCheck } from "./posterTypes.ts";
import type {
  PosterCopyV1,
  PosterDraftV1,
  PosterSpecV1,
  PosterStyleChoice,
  PosterTemplateId,
} from "./posterTypes.ts";

const DEFAULT_LAYOUT_POLICY: PosterSpecV1["layout_policy"] = {
  text_align: "center",
  safe_area_percent: 8,
  max_lines: {
    business_name: 1,
    headline: 2,
    offer_line_1: 1,
    offer_line_2: 1,
    subline: 1,
  },
};

const DEFAULT_CONTENT_POLICY: PosterSpecV1["content_policy"] = {
  no_app_brand_token: true,
  no_cta: true,
  no_scarcity: true,
  no_mutable_live_facts: true,
  image_text_free: true,
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function singularItem(value: string): string {
  return cleanText(value).replace(/\s+/g, " ");
}

const POSTER_ITEM_STOP_WORDS = new Set([
  "a",
  "an",
  "any",
  "the",
  "one",
  "of",
  "your",
  "choice",
  "large",
  "medium",
  "small",
  "regular",
  // R7: "hot", "iced", "ice", "cold" and "fresh" USED to be listed here as droppable
  // modifiers. They are not — they carry product identity rather than portion. "cold" is
  // noise in "cold milk" but half the product name in "cold brew", and dropping it put
  // "BREW FOR LESS" on a live poster at a shop called The Colonel's Brew. A flat list
  // cannot tell those two uses apart, so the tie is now broken the other way: keep them
  // and let the character budget decide what fits. Size words above stay droppable
  // because they never identify a product.
]);

// Connectors are never the head of an item name, and posterItemLabel keeps only the
// LAST two meaningful words. Without this set a three-word item reduces to a
// fragment: "Haircut and fade" -> ["haircut","and","fade"] -> slice(-2) -> "and
// fade", which reached a live poster as the headline "AND FADE FOR LESS". Dropping
// the connector instead yields "haircut fade", which keeps the head noun.
const POSTER_ITEM_CONNECTOR_WORDS = new Set(["and", "or", "plus", "with", "n"]);

const POSTER_KNOWN_ITEM_WORDS = [
  "americano",
  "coffee",
  "latte",
  "espresso",
  "cappuccino",
  "cookie",
  "bagel",
  "sandwich",
  "muffin",
  "croissant",
  "pastry",
  "scone",
  "tea",
  "drink",
  "taco",
  "dessert",
  "entree",
];

function normalizePosterComparison(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s+%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * R7: the known-word branch used to return the matched word ALONE, discarding every
 * modifier regardless of how much room the headline actually had. "12 ounce bag of whole
 * bean coffee" became "coffee" — on a poster for a coffee shop, which is close to
 * contentless — and "blueberry muffin" became "muffin".
 *
 * The discarded words nearly always fit: the headline limit is 28 and the label only needs
 * to fit 19 once " for less" is appended. So walk BACKWARDS from the known word and keep
 * the descriptive modifiers immediately in front of it while they fit the budget, stopping
 * at a stop word or connector — those mark the edge of the noun phrase, which is what keeps
 * "cookie of your choice" from reaching back past "of" and what keeps "any large coffee
 * drink" from picking up "large".
 */
function expandKnownItemWord(words: string[], known: string, maxChars: number): string {
  const index = words.lastIndexOf(known);
  if (index < 0) return known;
  let start = index;
  let out = known;
  while (start > 0) {
    const candidateWord = words[start - 1];
    if (POSTER_ITEM_STOP_WORDS.has(candidateWord) || POSTER_ITEM_CONNECTOR_WORDS.has(candidateWord)) break;
    const candidate = `${candidateWord} ${out}`;
    if (candidate.length > maxChars) break;
    out = candidate;
    start -= 1;
  }
  return out;
}

/**
 * Shortens an item name to something that fits `maxChars` while still naming the product.
 * `maxChars` defaults to the tightest real budget — the headline limit (28) minus the
 * longest suffix the fallback appends (" for less", 9).
 */
function posterItemLabel(value: string, maxChars = POSTER_TEXT_LIMITS.headline - 9): string {
  const normalized = normalizePosterComparison(value);
  if (!normalized) return "";
  const words = normalized.split(/\s+/).filter(Boolean);
  const known = POSTER_KNOWN_ITEM_WORDS.find((word) => words.includes(word));
  if (known && !(known === "drink" && words.includes("coffee"))) {
    return expandKnownItemWord(words, known, maxChars);
  }
  if (words.includes("coffee")) return expandKnownItemWord(words, "coffee", maxChars);
  const meaningful = words.filter(
    (word) => !POSTER_ITEM_STOP_WORDS.has(word) && !POSTER_ITEM_CONNECTOR_WORDS.has(word),
  );
  if (meaningful.length === 0) {
    return words.filter((word) => !POSTER_ITEM_CONNECTOR_WORDS.has(word)).slice(0, 2).join(" ");
  }
  // Head-final tail, trimmed to what fits: "large cold brew" -> "cold brew".
  let tail = meaningful.slice(-2).join(" ");
  while (tail.length > maxChars && tail.includes(" ")) {
    tail = tail.slice(tail.indexOf(" ") + 1);
  }
  return tail;
}

/**
 * English item names are head-final: the noun that identifies the product sits at the END
 * ("12 ounce bag of whole bean COFFEE"). `clampPosterText` fills from the FRONT, so an
 * over-long item keeps its modifiers and drops the noun. Observed live on a published
 * poster (Tier-3 J4): "12 ounce bag of whole bean coffee" rendered as
 *
 *     40% OFF
 *     12 OUNCE BAG OF WHOLE      <- 21 chars; " BEAN" would take it to 26 over a 24 limit
 *
 * which names no product at all. Offer lines are the poster's FACT channel, and deal facts
 * are authoritative — a shorter COMPLETE phrase beats a longer fragment.
 *
 * So prefer the longest word-aligned SUFFIX that fits, then drop any leading stop or
 * connector word so we never emit "OF WHOLE BEAN COFFEE". The same suffix bias is why
 * `posterItemLabel` uses `slice(-2)`. Returns the input untouched when it already fits or
 * when no suffix helps, leaving the caller's clamp as the last resort.
 */
function fitItemLine(value: string, maxChars: number): string {
  const clean = cleanText(value);
  if (!clean || clean.length <= maxChars) return clean;
  const words = clean.split(/\s+/);
  for (let start = 1; start < words.length; start += 1) {
    let slice = words.slice(start);
    while (
      slice.length > 1 &&
      (POSTER_ITEM_STOP_WORDS.has(slice[0].toLowerCase()) ||
        POSTER_ITEM_CONNECTOR_WORDS.has(slice[0].toLowerCase()))
    ) {
      slice = slice.slice(1);
    }
    const candidate = slice.join(" ");
    if (candidate && candidate.length <= maxChars) return candidate;
  }
  return clean;
}

// Spanish is head-INITIAL: "galleta de tu elección" names the product in its first word and
// hangs qualifiers off "de". `fitItemLine`'s suffix bias is therefore backwards for it, and
// POSTER_ITEM_STOP_WORDS is English-only, so it would happily emit "DE TU ELECCIÓN".
const ES_LEADING_DETERMINERS = new Set([
  "cualquier", "cualquiera", "un", "una", "unos", "unas",
  "el", "la", "los", "las", "tu", "tus", "su", "sus", "mi", "mis",
]);
const ES_TRAILING_FUNCTION_WORDS = new Set([
  "de", "del", "la", "el", "los", "las", "tu", "tus", "su", "sus",
  "y", "con", "a", "al", "en", "para",
]);

/**
 * Fit a LOCALIZED item name, keeping the words that actually name the product.
 *
 * English and Korean are head-final, so `fitItemLine`'s suffix bias is right for them.
 * Spanish is head-initial, so it needs the mirror image: drop a leading determiner, then
 * keep the longest fitting PREFIX, never ending on a function word.
 *
 * Nothing is dropped while the name still fits — "cualquier bebida" must not quietly become
 * "bebida", because "cualquier" ("any") is part of what the merchant is offering.
 */
function fitLocalizedItem(value: string, maxChars: number, locale: SupportedLocale): string {
  if (locale !== "es-US") return fitItemLine(value, maxChars);
  const clean = cleanText(value);
  if (!clean || clean.length <= maxChars) return clean;
  let words = clean.split(/\s+/);
  if (words.length > 1 && ES_LEADING_DETERMINERS.has(words[0].toLowerCase())) {
    words = words.slice(1);
  }
  const trimTrailing = (slice: string[]): string[] => {
    let out = slice;
    while (out.length > 1 && ES_TRAILING_FUNCTION_WORDS.has(out[out.length - 1].toLowerCase())) {
      out = out.slice(0, -1);
    }
    return out;
  };
  for (let end = words.length; end >= 1; end -= 1) {
    const candidate = trimTrailing(words.slice(0, end)).join(" ");
    if (candidate && candidate.length <= maxChars) return candidate;
  }
  return trimTrailing(words).join(" ");
}

const ITEM_PROBE = "";

/**
 * Compose an offer line from a locale template, fitting the ITEM to whatever the template's
 * fixed words leave over.
 *
 * Clamping the FINISHED line is what deleted the offer in Spanish. English states the offer
 * with a prefix ("FREE <item>"), so a front clamp only ever shortens the item; es-US and
 * ko-KR state it with a suffix ("<item> GRATIS", "<item> 무료"), so the same clamp eats the
 * one word that says anything is free. "GALLETA DE TU ELECCIÓN GRATIS" is 29 against a
 * 28-char budget and lost GRATIS by a single character. Measuring the affix first keeps the
 * fixed words safe by construction, in every locale.
 */
function composeOfferLine(
  compose: (itemName: string) => string,
  itemName: string,
  locale: SupportedLocale,
  maxChars: number,
): string {
  const overhead = compose(ITEM_PROBE).length - ITEM_PROBE.length;
  const fitted = fitLocalizedItem(itemName, Math.max(1, maxChars - overhead), locale);
  return compose(fitted);
}

function lineItem(value: string, maxChars = 22): string {
  return sanitizePosterText(value, { fallback: "LOCAL DEAL", maxChars });
}

function isMechanicalOfferHeadline(value: string): boolean {
  const text = cleanText(value).toLowerCase();
  if (!text) return false;
  if (/\bbuy\b/.test(text) && /\bget\b/.test(text)) return true;
  if (/\b\d+\s*%\s*off\b/.test(text)) return true;
  if (/\bfree\b/.test(text) && /\bwith\b|\bbuy\b|\bpurchase\b/.test(text)) return true;
  return false;
}

function isWeakPosterHeroHeadline(value: string): boolean {
  const text = normalizePosterComparison(value);
  return /^try\s+(?:our|the)\b/.test(text);
}

export function sanitizePosterBusinessName(
  input: string | null | undefined,
  category?: string | null,
): string {
  const categoryClean = cleanText(category).toLowerCase();
  const fallback =
    categoryClean.includes("bakery") ? "Local Bakery" :
    categoryClean.includes("cafe") || categoryClean.includes("coffee") ? "Local Cafe" :
    categoryClean.includes("kitchen") || categoryClean.includes("restaurant") ? "Local Kitchen" :
    "Local Favorite";
  return sanitizePosterText(input ?? "", {
    fallback,
    maxChars: POSTER_TEXT_LIMITS.businessName,
    uppercase: false,
  });
}

/**
 * Merchant-typed poster headline check. The AI path falls back deterministically
 * on a bad headline (posterHeadline below); merchant edits must instead be
 * blocked with these reason codes so the published poster never silently
 * diverges from what the owner typed.
 */
export function checkMerchantPosterHeadline(value: string | null | undefined): PosterTextFitCheck {
  const requested = cleanText(value);
  const fit = checkPosterTextFit(requested, POSTER_TEXT_LIMITS.headline);
  if (!requested) return fit;
  const reasonCodes = [...fit.reasonCodes];
  if (isWeakPosterHeroHeadline(requested)) reasonCodes.push("POSTER_HEADLINE_WEAK_OPENER");
  if (isMechanicalOfferHeadline(requested)) reasonCodes.push("POSTER_HEADLINE_MECHANICAL");
  return {
    ...fit,
    ok: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

export function checkMerchantPosterSubline(value: string | null | undefined): PosterTextFitCheck {
  const fit = checkPosterTextFit(cleanText(value), POSTER_TEXT_LIMITS.subline);
  const reasonCodes = [...fit.reasonCodes];
  if (isGenericPosterKicker(value)) reasonCodes.push("POSTER_SUBLINE_GENERIC_KICKER");
  return {
    ...fit,
    ok: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

export function choosePosterTemplateForOffer(
  style: PosterStyleChoice | null | undefined,
  definition: OfferDefinitionV1,
  businessCategory?: string | null,
): PosterTemplateId {
  if (style === "fresh" || style === "bold" || style === "premium") return style;
  const category = cleanText(businessCategory).toLowerCase();
  if (category.includes("coffee") || category.includes("cafe") || category.includes("bakery")) return "fresh";
  if (definition.offerType === "percent_off_single_item") return "bold";
  return "premium";
}

type PosterOfferLines = Pick<PosterCopyV1, "offer_line_1" | "offer_line_2">;

function localeNumber(locale: SupportedLocale, value: number): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.floor(value)));
}

function posterTermDisplayName(term: LocalizedOfferTerm): string {
  return cleanText(term.shortDisplayName) || cleanText(term.displayName);
}

function firstQualifyingItem(definition: OfferDefinitionV1) {
  return definition.qualifyingItems[0] ?? {
    catalogItemId: null,
    displayName: "item",
    quantity: 1,
    verifiedAttributes: [],
  };
}

function localizedPaidTerm(definition: OfferDefinitionV1, locale: SupportedLocale): LocalizedOfferTerm {
  const item = firstQualifyingItem(definition);
  return resolveLocalizedOfferTerm({
    entityId: item.catalogItemId,
    sourceDisplayName: item.displayName,
    locale,
  });
}

function localizedRewardTerm(definition: OfferDefinitionV1, locale: SupportedLocale): LocalizedOfferTerm {
  const item = firstQualifyingItem(definition);
  const rewardItem = definition.reward.displayNames[0] ?? item.displayName;
  return resolveLocalizedOfferTerm({
    entityId:
      definition.reward.rule === "percent_off_single_item"
        ? item.catalogItemId
        : `reward:${rewardItem}`,
    sourceDisplayName: rewardItem,
    locale,
  });
}

function discountBadge(locale: SupportedLocale, percent: number): string {
  const value = localeNumber(locale, Math.round(percent));
  if (locale === "es-US") return `${value}% DE DESCUENTO`;
  if (locale === "ko-KR") return `${value}% \uD560\uC778`;
  return `${value}% OFF`;
}

function sameItemBadge(locale: SupportedLocale, paidQuantity: number, rewardQuantity: number): string {
  const quantity = localeNumber(locale, rewardQuantity);
  const isClassicBogo = paidQuantity === 1 && rewardQuantity === 1;
  if (locale === "es-US") return isClassicBogo ? "2 POR 1" : `${quantity} GRATIS`;
  if (locale === "ko-KR") return `\uCD94\uAC00 ${quantity} \uBB34\uB8CC`;
  return isClassicBogo ? "2 FOR 1" : `GET ${quantity} FREE`;
}

function freeRewardBadge(locale: SupportedLocale, rewardName: string, rewardQuantity: number): string {
  const quantity = localeNumber(locale, rewardQuantity);
  if (locale === "es-US") {
    return rewardQuantity === 1 ? `${rewardName} GRATIS` : `${quantity} ${rewardName} GRATIS`;
  }
  if (locale === "ko-KR") {
    return rewardQuantity === 1
      ? `${rewardName} \uBB34\uB8CC`
      : `${rewardName} x ${quantity} \uBB34\uB8CC`;
  }
  return rewardQuantity === 1 ? `FREE ${rewardName}` : `${quantity} FREE ${rewardName}`;
}

function purchaseContextLine(locale: SupportedLocale, paidName: string, paidQuantity: number): string {
  const quantity = localeNumber(locale, paidQuantity);
  if (locale === "es-US") return `AL COMPRAR ${quantity} ${paidName}`;
  if (locale === "ko-KR") return `${paidName} x ${quantity} \uAD6C\uB9E4 \uC2DC`;
  return paidQuantity === 1 ? `WITH ${paidName}` : `WITH ${quantity} ${paidName}`;
}

export function buildPosterOfferLinesFromOfferDefinition(
  definition: OfferDefinitionV1,
  locale: SupportedLocale = "en-US",
): PosterOfferLines {
  const localizedOffer = renderLocalizedOfferBundleFromDefinition(definition)[locale];
  const paidTerm = localizedPaidTerm(definition, locale);
  const rewardTerm = localizedRewardTerm(definition, locale);
  const firstItem = singularItem(posterTermDisplayName(paidTerm) || definition.qualifyingItems[0]?.displayName || "");
  const rewardItem = singularItem(posterTermDisplayName(rewardTerm) || definition.reward.displayNames[0] || firstItem);

  if (definition.reward.rule === "percent_off_single_item") {
    return {
      offer_line_1: lineItem(discountBadge(locale, definition.reward.discountPercent), 20),
      offer_line_2: lineItem(
        fitLocalizedItem(rewardItem || firstItem || localizedOffer.compactOfferLine, 24, locale),
        24,
      ),
    };
  }

  const paidQuantity = definition.qualifyingItems[0]?.quantity ?? 1;
  const rewardQuantity = definition.reward.quantity;

  if (definition.reward.rule === "same_item_free") {
    return {
      offer_line_1: lineItem(sameItemBadge(locale, paidQuantity, rewardQuantity), 18),
      offer_line_2: lineItem(
        fitLocalizedItem(firstItem || localizedOffer.compactOfferLine, 24, locale),
        24,
      ),
    };
  }

  return {
    offer_line_1: lineItem(
      composeOfferLine((name) => freeRewardBadge(locale, name, rewardQuantity), rewardItem, locale, 28),
      28,
    ),
    offer_line_2: lineItem(
      composeOfferLine((name) => purchaseContextLine(locale, name, paidQuantity), firstItem, locale, 28),
      28,
    ),
  };
}

function posterHeadlineFallback(definition: OfferDefinitionV1): string {
  const paidName = definition.qualifyingItems[0]?.displayName ?? "";
  const rewardName = definition.reward.displayNames[0] ?? "";
  // Each branch appends a different suffix, so each gets its own budget rather than one
  // shared worst case. Without this, R7's longer labels would overflow the pair branch and
  // trade one fragment for another: two 17-char labels make a 37-char pair, which the
  // 28-char headline clamp would then cut mid-phrase.
  const firstItem = posterItemLabel(paidName, POSTER_TEXT_LIMITS.headline - " for less".length);
  const rewardItem = posterItemLabel(rewardName, POSTER_TEXT_LIMITS.headline - " for less".length);

  if (definition.offerType === "percent_off_single_item") {
    // Not "<item> savings" / "local deal": the offer block already renders the
    // discount, so labelling it a deal says nothing the poster does not already
    // show, and it reads as filler on a paid ad. Both old strings are also exactly
    // what POSTER_HEADLINE_FORMULAIC_VALUE now rejects in AI copy — the
    // deterministic fallback must not emit copy the gate would refuse.
    return firstItem ? `${firstItem} for less` : "A local price drop";
  }

  if (definition.reward.rule === "same_item_free") {
    const label = posterItemLabel(paidName, POSTER_TEXT_LIMITS.headline - " bonus".length);
    return label ? `${label} bonus` : "local bonus";
  }

  // " break" is only appended when the pair fits 22, so budget each side to keep it there.
  const pairBudget = Math.floor((22 - " + ".length) / 2);
  const paidPair = posterItemLabel(paidName, pairBudget);
  const rewardPair = posterItemLabel(rewardName, pairBudget);
  if (paidPair && rewardPair) {
    const pair = `${paidPair} + ${rewardPair}`;
    return pair.length <= 22 ? `${pair} break` : pair;
  }

  return firstItem || rewardItem || "local deal";
}

function posterHeadline(definition: OfferDefinitionV1, requestedHeadline?: string | null): string {
  const fallback = posterHeadlineFallback(definition);
  const requested = cleanText(requestedHeadline);
  if (!requested) return fallback;
  if (!scanPosterTextPolicy(requested).passed) return fallback;
  if (isWeakPosterHeroHeadline(requested)) return fallback;
  if (isMechanicalOfferHeadline(requested)) return fallback;
  return requested;
}

export function buildPosterCopyFromOfferDefinition(params: {
  definition: OfferDefinitionV1;
  headline?: string | null;
  subline?: string | null;
  businessCategory?: string | null;
}): PosterCopyV1 {
  const businessName = sanitizePosterBusinessName(params.definition.merchantName, params.businessCategory);
  const lines = buildPosterOfferLinesFromOfferDefinition(params.definition);
  const headline = posterHeadline(params.definition, params.headline);
  const base: PosterCopyV1 = {
    business_name: businessName,
    headline: sanitizePosterText(headline, {
      fallback: posterHeadlineFallback(params.definition),
      maxChars: POSTER_TEXT_LIMITS.headline,
    }),
    offer_line_1: lines.offer_line_1,
    offer_line_2: lines.offer_line_2,
    ...(cleanText(params.subline)
      ? {
          subline: sanitizePosterText(params.subline ?? "", {
            fallback: "",
            maxChars: POSTER_TEXT_LIMITS.subline,
          }),
        }
      : {}),
  };
  return sanitizePosterCopy(base, businessName).copy;
}

function copyForLocale(
  definition: OfferDefinitionV1,
  locale: SupportedLocale,
  base: PosterCopyV1,
  sourceLocale: SupportedLocale,
): PosterCopyV1 {
  const lines = buildPosterOfferLinesFromOfferDefinition(definition, locale);
  return {
    ...base,
    // The AI writes the creative headline in English only, and `validatePosterSpecV1` binds
    // BOTH offer lines to the deterministic lines for every locale (facts are authoritative),
    // so there is no spare slot a localized hook could occupy. Substituting an offer line
    // here is what made every es/ko poster print the same sentence twice in two type sizes:
    // the hero said "AL COMPRAR 1 CUALQUIER" and so did the line under it. Leave the hero
    // EMPTY instead. The offer is still stated in full by offer_line_1 + offer_line_2, and
    // `assertPosterCopyPolicy` treats a missing headline as a warning, not a failure.
    // Fill this once the localization bundle can supply a translated headline at
    // poster-build time — today it is generated after the poster spec is built.
    headline: locale === sourceLocale ? base.headline : "",
    offer_line_1: lines.offer_line_1,
    offer_line_2: lines.offer_line_2,
    // Merchant-authored creative text belongs only to the deal's source
    // language. Never leak it into untranslated customer-language variants.
    subline: locale === sourceLocale ? base.subline : undefined,
  };
}

export function buildPosterCopyByLanguage(params: {
  definition: OfferDefinitionV1;
  baseCopy: PosterCopyV1;
  sourceLocale?: SupportedLocale;
}): Record<SupportedLocale, PosterCopyV1> {
  const sourceLocale = params.sourceLocale ?? "en-US";
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => {
      const copy = copyForLocale(params.definition, locale, params.baseCopy, sourceLocale);
      const sanitized = sanitizePosterCopy(copy, params.baseCopy.business_name).copy;
      // `sanitizePosterCopy` fills an empty headline from `offer_line_1` — a sensible safety
      // net for the English path, but for a non-English locale it would re-create exactly
      // the duplicate `copyForLocale` just removed, this time hero-vs-gold instead of
      // hero-vs-white. Re-assert the empty hero after sanitizing.
      return [locale, locale === sourceLocale ? sanitized : { ...sanitized, headline: "" }];
    }),
  ) as Record<SupportedLocale, PosterCopyV1>;
}

export function buildPosterSpecFromOfferDefinition(params: {
  definition: OfferDefinitionV1;
  enabled: boolean;
  templateId: PosterTemplateId;
  sourceAssetPath?: string | null;
  renderedAssetPath?: string | null;
  headline?: string | null;
  subline?: string | null;
  sourceLocale?: SupportedLocale;
  businessCategory?: string | null;
  compositionPlan?: string | null;
}): PosterDraftV1 {
  const baseCopy = buildPosterCopyFromOfferDefinition({
    definition: params.definition,
    headline: params.headline,
    subline: params.subline,
    businessCategory: params.businessCategory,
  });
  const byLanguage = buildPosterCopyByLanguage({
    definition: params.definition,
    baseCopy,
    sourceLocale: params.sourceLocale,
  });
  const policy = assertPosterCopyPolicy(baseCopy);
  return {
    version: 1,
    enabled: params.enabled,
    template_id: params.templateId,
    aspect_ratio: "4:5",
    source_asset_path: cleanText(params.sourceAssetPath) || null,
    rendered_asset_path: cleanText(params.renderedAssetPath) || null,
    copy: baseCopy,
    copy_by_language: byLanguage,
    layout_policy: DEFAULT_LAYOUT_POLICY,
    content_policy: DEFAULT_CONTENT_POLICY,
    policy,
    composition_plan: cleanText(params.compositionPlan) || null,
  };
}

export function normalizePosterSpecForPublish<T extends PosterDraftV1 | PosterSpecV1>(
  spec: T,
  sourceLocale: SupportedLocale | string | null | undefined = "en-US",
): T {
  const normalizedSourceLocale = supportedLocaleOrDefault(sourceLocale);
  const sourceCopy =
    spec.copy_by_language[normalizedSourceLocale] ??
    ("copy" in spec ? spec.copy : null) ??
    Object.values(spec.copy_by_language)[0];
  if (!sourceCopy) return spec;
  return {
    ...spec,
    ...("copy" in spec ? { copy: sourceCopy } : {}),
    copy_by_language: { [normalizedSourceLocale]: sourceCopy } as T["copy_by_language"],
  };
}
