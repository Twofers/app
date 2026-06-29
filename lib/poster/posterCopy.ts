import { renderLocalizedOfferBundleFromDefinition } from "../localized-offer-renderer.ts";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../supported-locales.ts";
import type { OfferDefinitionV1 } from "../offer-definition.ts";
import {
  assertPosterCopyPolicy,
  sanitizePosterCopy,
  sanitizePosterText,
  scanPosterTextPolicy,
} from "./posterPolicy.ts";
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

const POSTER_KNOWN_ITEM_WORDS = [
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
  const meaningful = words.filter((word) => !POSTER_ITEM_STOP_WORDS.has(word));
  if (meaningful.length === 0) return words.slice(0, 2).join(" ");
  return meaningful.slice(-2).join(" ");
}

function posterHeadlineFallback(definition: OfferDefinitionV1): string {
  const firstItem = posterItemLabel(definition.qualifyingItems[0]?.displayName ?? "");
  const rewardItem = posterItemLabel(definition.reward.displayNames[0] ?? "");

  if (definition.offerType === "percent_off_single_item") {
    return firstItem ? `${firstItem} savings` : "local deal";
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

function qtyLabel(quantity: number): string {
  return Number.isFinite(quantity) && quantity > 1 ? String(Math.floor(quantity)) : "1";
}

function posterQuantityItemLine(action: "BUY" | "GET", quantity: number, itemName: string, fallbackItem: string): string {
  const item = singularItem(itemName || fallbackItem);
  if (/^any\s+/i.test(item)) return `${action} ${item}`;
  return `${action} ${qtyLabel(quantity)} ${item || fallbackItem}`;
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

function isBareOfferItemHeadline(value: string, definition: OfferDefinitionV1): boolean {
  const headline = normalizePosterComparison(value);
  if (!headline) return false;
  const itemNames = [
    definition.qualifyingItems[0]?.displayName,
    ...definition.reward.displayNames,
  ].map((item) => normalizePosterComparison(item ?? "")).filter(Boolean);
  if (itemNames.some((item) => headline === item)) return true;

  const itemLabels = itemNames.map(posterItemLabel).filter(Boolean);
  if (itemLabels.some((label) => headline === normalizePosterComparison(label))) return true;

  const words = headline.split(/\s+/).filter((word) => !POSTER_ITEM_STOP_WORDS.has(word));
  const normalizedWords = words.join(" ");
  return itemLabels.some((label) => {
    const normalizedLabel = normalizePosterComparison(label);
    return normalizedWords === normalizedLabel || (words.length <= 3 && words.includes(normalizedLabel));
  });
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
    maxChars: 34,
    uppercase: false,
  });
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

export function buildPosterOfferLinesFromOfferDefinition(definition: OfferDefinitionV1): Pick<PosterCopyV1, "offer_line_1" | "offer_line_2"> {
  const firstItem = singularItem(definition.qualifyingItems[0]?.displayName ?? "");
  const rewardItem = singularItem(definition.reward.displayNames[0] ?? firstItem);

  if (definition.reward.rule === "percent_off_single_item") {
    return {
      offer_line_1: `${Math.round(definition.reward.discountPercent)}% OFF`,
      offer_line_2: lineItem(rewardItem || firstItem, 24),
    };
  }

  return {
    offer_line_1: lineItem(posterQuantityItemLine("BUY", definition.qualifyingItems[0]?.quantity ?? 1, firstItem, "ITEM"), 28),
    offer_line_2:
      definition.reward.rule === "same_item_free"
        ? lineItem(`GET ${qtyLabel(definition.reward.quantity)} FREE`, 22)
        : lineItem(posterQuantityItemLine("GET", definition.reward.quantity, rewardItem, "FREE"), 28),
  };
}

function posterHeadline(definition: OfferDefinitionV1, requestedHeadline?: string | null): string {
  const fallback = posterHeadlineFallback(definition);
  const requested = cleanText(requestedHeadline);
  if (!requested) return fallback;
  if (!scanPosterTextPolicy(requested).passed) return fallback;
  if (isWeakPosterHeroHeadline(requested)) return fallback;
  if (isMechanicalOfferHeadline(requested)) return fallback;
  if (isBareOfferItemHeadline(requested, definition)) return fallback;
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
      maxChars: 32,
    }),
    offer_line_1: lines.offer_line_1,
    offer_line_2: lines.offer_line_2,
    ...(cleanText(params.subline)
      ? {
          subline: sanitizePosterText(params.subline ?? "", {
            fallback: "",
            maxChars: 32,
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
  const localized = renderLocalizedOfferBundleFromDefinition(definition)[locale];
  const lines = buildPosterOfferLinesFromOfferDefinition({
    ...definition,
    canonicalOfferLine: localized.primaryOfferLine,
  });
  return {
    ...base,
    offer_line_1: lines.offer_line_1,
    offer_line_2: lines.offer_line_2,
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
