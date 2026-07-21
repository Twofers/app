import {
  resolveLocalizedOfferTerm,
  type LocalizedOfferTerm,
} from "../localized-offer-terms.ts";
import { renderLocalizedOfferBundleFromDefinition } from "../localized-offer-renderer.ts";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../supported-locales.ts";
import type { OfferDefinitionV1 } from "../offer-definition.ts";
import {
  assertPosterCopyPolicy,
  checkPosterTextFit,
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
  "hot",
  "iced",
  "ice",
  "cold",
  "fresh",
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

function posterItemLabel(value: string): string {
  const normalized = normalizePosterComparison(value);
  if (!normalized) return "";
  const words = normalized.split(/\s+/).filter(Boolean);
  const known = POSTER_KNOWN_ITEM_WORDS.find((word) => words.includes(word));
  if (known && !(known === "drink" && words.includes("coffee"))) return known;
  if (words.includes("coffee")) return "coffee";
  const meaningful = words.filter(
    (word) => !POSTER_ITEM_STOP_WORDS.has(word) && !POSTER_ITEM_CONNECTOR_WORDS.has(word),
  );
  if (meaningful.length === 0) {
    return words.filter((word) => !POSTER_ITEM_CONNECTOR_WORDS.has(word)).slice(0, 2).join(" ");
  }
  return meaningful.slice(-2).join(" ");
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
  return checkPosterTextFit(cleanText(value), POSTER_TEXT_LIMITS.subline);
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
      offer_line_2: lineItem(fitItemLine(rewardItem || firstItem || localizedOffer.compactOfferLine, 24), 24),
    };
  }

  const paidQuantity = definition.qualifyingItems[0]?.quantity ?? 1;
  const rewardQuantity = definition.reward.quantity;

  if (definition.reward.rule === "same_item_free") {
    return {
      offer_line_1: lineItem(sameItemBadge(locale, paidQuantity, rewardQuantity), 18),
      offer_line_2: lineItem(fitItemLine(firstItem || localizedOffer.compactOfferLine, 24), 24),
    };
  }

  return {
    offer_line_1: lineItem(freeRewardBadge(locale, rewardItem, rewardQuantity), 28),
    offer_line_2: lineItem(purchaseContextLine(locale, firstItem, paidQuantity), 28),
  };
}

function posterHeadlineFallback(definition: OfferDefinitionV1): string {
  const firstItem = posterItemLabel(definition.qualifyingItems[0]?.displayName ?? "");
  const rewardItem = posterItemLabel(definition.reward.displayNames[0] ?? "");

  if (definition.offerType === "percent_off_single_item") {
    // Not "<item> savings" / "local deal": the offer block already renders the
    // discount, so labelling it a deal says nothing the poster does not already
    // show, and it reads as filler on a paid ad. Both old strings are also exactly
    // what POSTER_HEADLINE_FORMULAIC_VALUE now rejects in AI copy — the
    // deterministic fallback must not emit copy the gate would refuse.
    return firstItem ? `${firstItem} for less` : "A local price drop";
  }

  if (definition.reward.rule === "same_item_free") {
    return firstItem ? `${firstItem} bonus` : "local bonus";
  }

  if (firstItem && rewardItem) {
    const pair = `${firstItem} + ${rewardItem}`;
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
): PosterCopyV1 {
  const lines = buildPosterOfferLinesFromOfferDefinition(definition, locale);
  return {
    ...base,
    headline:
      locale === "en-US"
        ? base.headline
        : sanitizePosterText(lines.offer_line_2, {
            fallback: base.headline,
            maxChars: POSTER_TEXT_LIMITS.headline,
          }),
    offer_line_1: lines.offer_line_1,
    offer_line_2: lines.offer_line_2,
    subline: undefined,
  };
}

export function buildPosterCopyByLanguage(params: {
  definition: OfferDefinitionV1;
  baseCopy: PosterCopyV1;
}): Record<SupportedLocale, PosterCopyV1> {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => {
      const copy = copyForLocale(params.definition, locale, params.baseCopy);
      return [locale, sanitizePosterCopy(copy, params.baseCopy.business_name).copy];
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

export function normalizePosterSpecForPublish<T extends PosterDraftV1 | PosterSpecV1>(spec: T): T {
  const enCopy = spec.copy_by_language["en-US"] ?? ("copy" in spec ? spec.copy : null) ?? Object.values(spec.copy_by_language)[0];
  if (!enCopy) return spec;
  return {
    ...spec,
    ...("copy" in spec ? { copy: enCopy } : {}),
    copy_by_language: { "en-US": enCopy } as T["copy_by_language"],
  };
}
