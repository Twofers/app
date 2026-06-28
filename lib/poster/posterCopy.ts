import { renderLocalizedOfferBundleFromDefinition } from "../localized-offer-renderer.ts";
import { SUPPORTED_LOCALES, type SupportedLocale } from "../supported-locales.ts";
import type { OfferDefinitionV1 } from "../offer-definition.ts";
import {
  assertPosterCopyPolicy,
  sanitizePosterCopy,
  sanitizePosterText,
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

function qtyLabel(quantity: number): string {
  return Number.isFinite(quantity) && quantity > 1 ? String(Math.floor(quantity)) : "1";
}

function lineItem(value: string, maxChars = 22): string {
  return sanitizePosterText(value, { fallback: "LOCAL DEAL", maxChars });
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
  const firstQty = qtyLabel(definition.qualifyingItems[0]?.quantity ?? 1);
  const rewardItem = singularItem(definition.reward.displayNames[0] ?? firstItem);

  if (definition.reward.rule === "percent_off_single_item") {
    return {
      offer_line_1: `${Math.round(definition.reward.discountPercent)}% OFF`,
      offer_line_2: lineItem(rewardItem || firstItem, 24),
    };
  }

  return {
    offer_line_1: lineItem(`BUY ${firstQty} ${firstItem || "ITEM"}`, 28),
    offer_line_2:
      definition.reward.rule === "same_item_free"
        ? lineItem(`GET ${qtyLabel(definition.reward.quantity)} FREE`, 22)
        : lineItem(`GET ${qtyLabel(definition.reward.quantity)} ${rewardItem || "FREE"}`, 28),
  };
}

function headlineFallback(definition: OfferDefinitionV1): string {
  const item = cleanText(definition.qualifyingItems[0]?.displayName ?? definition.reward.displayNames[0] ?? "");
  if (definition.offerType === "percent_off_single_item") return item ? `SAVE ON ${item}` : "LOCAL DEAL";
  return item ? `${item} PAIRING` : "LOCAL DEAL";
}

export function buildPosterCopyFromOfferDefinition(params: {
  definition: OfferDefinitionV1;
  headline?: string | null;
  subline?: string | null;
  businessCategory?: string | null;
}): PosterCopyV1 {
  const businessName = sanitizePosterBusinessName(params.definition.merchantName, params.businessCategory);
  const lines = buildPosterOfferLinesFromOfferDefinition(params.definition);
  const base: PosterCopyV1 = {
    business_name: businessName,
    headline: sanitizePosterText(params.headline ?? "", {
      fallback: headlineFallback(params.definition),
      maxChars: 28,
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
