import {
  renderLocalizedOfferFromDefinition,
  type LocalizedLockedOfferContent,
} from "./localized-offer-renderer";
import type { LocalizedDealFields } from "./deal-localization";
import { localizedDealDescription, localizedDealTitle } from "./deal-localization";
import type { DealStructuredDisplayFields } from "./deal-feed-schema";
import { buildOfferDefinitionV1, type OfferDefinitionV1 } from "./offer-definition";
import {
  resolveAdLocale,
  type AdLocaleResolutionSource,
  type ResolvedAdLocale,
} from "./ad-locale-resolver";
import {
  normalizeSupportedLocale,
  supportedLocaleToAppLanguage,
  type SupportedLocale,
} from "./supported-locales";

export type LocalizedDealDisplayFields = LocalizedDealFields & DealStructuredDisplayFields & {
  id?: string | null;
  business_id?: string | null;
  max_claims?: number | string | null;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  businesses?: {
    name?: string | null;
    location?: string | null;
    address?: string | null;
  } | null;
};

export type LocalizedDealDisplay = {
  title: string;
  description: string;
  renderedLocale: SupportedLocale;
  localeResolutionSource: AdLocaleResolutionSource;
  source: "localized_offer_renderer" | "legacy_localized_fields";
  lockedOfferContent?: LocalizedLockedOfferContent;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function positiveInt(value: unknown): number | null {
  const n = numeric(value);
  return n != null && n > 0 ? Math.floor(n) : null;
}

function dealType(value: unknown): "BUY_ONE_GET_ONE_FREE" | "BUY_ONE_GET_SOMETHING_FREE" | "PERCENT_OFF_SINGLE_ITEM" | null {
  const clean = cleanText(value).toUpperCase();
  if (clean === "BUY_ONE_GET_ONE_FREE") return "BUY_ONE_GET_ONE_FREE";
  if (clean === "BUY_ONE_GET_SOMETHING_FREE") return "BUY_ONE_GET_SOMETHING_FREE";
  if (clean === "PERCENT_OFF_SINGLE_ITEM") return "PERCENT_OFF_SINGLE_ITEM";
  return null;
}

export function buildOfferDefinitionFromDealDisplay(
  deal: LocalizedDealDisplayFields | null | undefined,
): OfferDefinitionV1 | null {
  if (!deal) return null;
  const type = dealType(deal.deal_type ?? deal.offer_type ?? deal.type);
  if (!type) return null;
  const businessName = cleanText(deal.businesses?.name) || "Local business";
  const locationName = cleanText(deal.businesses?.location) || cleanText(deal.businesses?.address) || businessName;
  const maxClaims = positiveInt(deal.max_claims);
  const base = {
    businessId: cleanText(deal.business_id) || "deal-business",
    businessName,
    locationId: cleanText(deal.business_id) || "deal-location",
    locationName,
    eligibilityResult: {
      eligible: true,
      eligibilityStatus: "VALID" as const,
      customerValuePercent: numeric(deal.customer_value_percent) ?? 50,
    },
    activeWindowHumanReadable: null,
    quantityLimit: maxClaims,
    schedule: {
      mode: "one_time" as const,
      summary: null,
      startsAt: cleanText(deal.start_time) || null,
      endsAt: cleanText(deal.end_time) || null,
      timeZone: cleanText(deal.timezone) || null,
    },
  };

  if (type === "PERCENT_OFF_SINGLE_ITEM") {
    const item = cleanText(deal.item_description);
    const discount = numeric(deal.discount_percent);
    if (!item || discount == null) return null;
    return buildOfferDefinitionV1({
      ...base,
      dealEligibility: {
        dealType: type,
        appliesTo: cleanText(deal.applies_to) || "SINGLE_ITEM",
        discountPercent: discount,
        itemDescription: item,
        itemRetailValueCents: numeric(deal.item_retail_value_cents),
      },
    });
  }

  const requiredItem = cleanText(deal.required_item_description);
  const rewardItem = cleanText(deal.free_item_description) || requiredItem;
  if (!requiredItem || !rewardItem) return null;
  return buildOfferDefinitionV1({
    ...base,
    dealEligibility: {
      dealType: type,
      appliesTo: cleanText(deal.applies_to) || "SINGLE_ITEM",
      requiredPurchaseQuantity: positiveInt(deal.required_purchase_quantity) ?? 1,
      requiredItemDescription: requiredItem,
      requiredItemRetailValueCents: numeric(deal.required_item_retail_value_cents),
      freeItemQuantity: positiveInt(deal.free_item_quantity) ?? 1,
      freeItemDescription: rewardItem,
      freeItemRetailValueCents: numeric(deal.free_item_retail_value_cents),
      freeItemDiscountPercent: numeric(deal.free_item_discount_percent) ?? 100,
    },
  });
}

export function resolveDealDisplayLocale(params: {
  customerPreferredLocale?: string | null;
  appLanguage?: string | null;
  deviceLanguage?: string | null;
  adSourceLocale?: string | null;
}): ResolvedAdLocale {
  return resolveAdLocale({
    customerPreferredLocale: params.customerPreferredLocale,
    appLanguage: params.appLanguage,
    deviceLanguage: params.deviceLanguage,
    adSourceLocale: normalizeSupportedLocale(params.adSourceLocale),
  });
}

export function buildLocalizedDealDisplay(params: {
  deal: LocalizedDealDisplayFields;
  locale: SupportedLocale;
  localeResolutionSource: AdLocaleResolutionSource;
  useLocalizedOfferRenderer: boolean;
  fallbackLanguage: string;
}): LocalizedDealDisplay {
  if (params.useLocalizedOfferRenderer) {
    const definition = buildOfferDefinitionFromDealDisplay(params.deal);
    if (definition) {
      const locked = renderLocalizedOfferFromDefinition(definition, { locale: params.locale });
      return {
        title: locked.primaryOfferLine,
        description: locked.termsLine,
        renderedLocale: params.locale,
        localeResolutionSource: params.localeResolutionSource,
        source: "localized_offer_renderer",
        lockedOfferContent: locked,
      };
    }
  }

  const appLanguage = supportedLocaleToAppLanguage(params.locale);
  return {
    title: localizedDealTitle(params.deal, appLanguage),
    description: localizedDealDescription(params.deal, appLanguage || params.fallbackLanguage),
    renderedLocale: params.locale,
    localeResolutionSource: params.localeResolutionSource,
    source: "legacy_localized_fields",
  };
}
