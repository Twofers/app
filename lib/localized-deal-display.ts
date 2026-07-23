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
import type { CustomerDealLocalization } from "./customer-deal-localizations";
import { dealItemTranslationLocales } from "./deal-item-translation-flag";
import { DEAL_ITEM_TRANSLATION_EXPANSION } from "./localized-offer-terms-expansion";

type LocalizedDealDisplayOfferVersionFields = {
  ad_spec?: unknown;
  adSpec?: unknown;
};

export type LocalizedDealDisplayFields = LocalizedDealFields & DealStructuredDisplayFields & {
  id?: string | null;
  business_id?: string | null;
  ad_spec?: unknown;
  adSpec?: unknown;
  offer_version?: LocalizedDealDisplayOfferVersionFields | LocalizedDealDisplayOfferVersionFields[] | null;
  offer_versions?: LocalizedDealDisplayOfferVersionFields | LocalizedDealDisplayOfferVersionFields[] | null;
  customer_deal_localization?: CustomerDealLocalization | null;
  customerDealLocalization?: CustomerDealLocalization | null;
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
  source: "approved_localization_storage" | "localized_offer_renderer" | "legacy_localized_fields";
  lockedOfferContent?: LocalizedLockedOfferContent;
  localizedCreative?: CustomerDealLocalization;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function firstOfferVersion(deal: LocalizedDealDisplayFields): LocalizedDealDisplayOfferVersionFields | null {
  const value = deal.offer_version ?? deal.offer_versions;
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" ? candidate : null;
}

function adSpecFromDeal(deal: LocalizedDealDisplayFields): unknown {
  const version = firstOfferVersion(deal);
  return deal.ad_spec ?? deal.adSpec ?? version?.ad_spec ?? version?.adSpec ?? null;
}

function translationStatus(value: unknown): CustomerDealLocalization["translationStatus"] | null {
  if (value === "source_creative" || value === "persuasive_transcreation" || value === "deterministic_fallback") {
    return value;
  }
  return null;
}

function qaDecision(value: unknown): CustomerDealLocalization["qaDecision"] | null {
  if (value === "not_required" || value === "pass" || value === "repair" || value === "block" || value === "unavailable") {
    return value;
  }
  return null;
}

function usableCustomerLocalization(
  value: unknown,
  locale: SupportedLocale,
  dealId: string | null,
): CustomerDealLocalization | null {
  const row = record(value);
  if (!row) return null;
  const rowLocale = normalizeSupportedLocale(cleanText(row.locale));
  const headline = cleanText(row.headline);
  const localizationHash = cleanText(row.localizationHash ?? row.localization_hash);
  const status = translationStatus(row.translationStatus ?? row.translation_status);
  const decision = qaDecision(row.qaDecision ?? row.qa_decision);
  if (rowLocale !== locale || !headline || !localizationHash || !status || !decision) return null;
  if (decision !== "not_required" && decision !== "pass") return null;

  return {
    dealId: cleanText(row.dealId ?? row.deal_id) || dealId || "",
    offerVersionId: cleanText(row.offerVersionId ?? row.offer_version_id) || null,
    locale,
    sourceLocale: normalizeSupportedLocale(cleanText(row.sourceLocale ?? row.source_locale)),
    headline,
    supportingCopy: cleanText(row.supportingCopy ?? row.supporting_copy) || null,
    imageAltText: cleanText(row.imageAltText ?? row.image_alt_text) || null,
    localizationHash,
    localizationBundleHash: cleanText(row.localizationBundleHash ?? row.localization_bundle_hash) || null,
    translationStatus: status,
    qaDecision: decision,
    qaReasonCodes: stringArray(row.qaReasonCodes ?? row.qa_reason_codes),
    deterministicFallback: Boolean(row.deterministicFallback ?? row.deterministic_fallback ?? status === "deterministic_fallback"),
    localeRendererVersion: cleanText(row.localeRendererVersion ?? row.locale_renderer_version) || null,
    localizedTermSnapshot: row.localizedTermSnapshot ?? row.localized_term_snapshot,
    localePresentationOverrides: row.localePresentationOverrides ?? row.locale_presentation_overrides,
  };
}

function localizationFromAdSpec(
  deal: LocalizedDealDisplayFields,
  locale: SupportedLocale,
): CustomerDealLocalization | null {
  const adSpec = record(adSpecFromDeal(deal));
  const localization = record(adSpec?.localization);
  const localizations = record(localization?.localizations);
  const approval = record(localization?.approval);
  const approvedRowHashes = record(approval?.localizationRowHashes);
  const row = usableCustomerLocalization(localizations?.[locale], locale, cleanText(deal.id) || null);
  if (!row) return null;

  const approvedRowHash = cleanText(approvedRowHashes?.[locale]);
  const approvedBundleHash = cleanText(approval?.localizationBundleHash);
  const bundleHash = cleanText(localization?.localizationBundleHash);
  if (!approvedRowHash || approvedRowHash !== row.localizationHash) return null;
  if (!approvedBundleHash || !bundleHash || approvedBundleHash !== bundleHash) return null;
  return {
    ...row,
    localizationBundleHash: row.localizationBundleHash || bundleHash,
    localeRendererVersion: row.localeRendererVersion || cleanText(localization?.localeRendererVersion) || null,
    localizedTermSnapshot: row.localizedTermSnapshot ?? localization?.localizedTermSnapshot,
    localePresentationOverrides: row.localePresentationOverrides ?? localization?.localePresentationOverrides,
  };
}

function customerLocalizationFromDeal(
  deal: LocalizedDealDisplayFields,
  locale: SupportedLocale,
): CustomerDealLocalization | null {
  return (
    usableCustomerLocalization(
      deal.customer_deal_localization ?? deal.customerDealLocalization,
      locale,
      cleanText(deal.id) || null,
    ) ?? localizationFromAdSpec(deal, locale)
  );
}

// Hiragana, Katakana, CJK ideographs and Hangul. A 2-character Korean word like 라떼
// ("latte") is a whole content word, so the Latin ">2 characters" rule would throw away
// almost every Korean token and make two unrelated Korean sentences look identical.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;

/** Content words, for deciding whether two strings say the same thing. */
function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => (CJK_RE.test(word) ? word.length >= 2 : word.length > 2)),
  );
}

/**
 * S13: the description was assembled from the AI's supporting copy, the deterministic
 * primary offer line and the terms line — three PARAPHRASES of the same offer. Exact-match
 * dedup never fired, so a live deal read:
 *
 *   "Buy any large coffee drink and the cookie of your choice is on us. Buy any large
 *    coffee drink and get a free cookie of your choice Purchase any large c…"
 *
 * Paraphrases share their content words even when no substring matches, so compare token
 * overlap instead of equality.
 *
 * The threshold sits where it does because the two populations are far apart, not because
 * 0.6 is magic. Measured: the live duplicate scored 0.82 and a looser paraphrase of the same
 * offer scores 0.67, while the terms line — which carries the address, the claim limit and
 * the schedule, and must NEVER be dropped — scores under 0.3 against any supporting copy,
 * because almost all of its content words appear nowhere else. Anywhere in 0.5-0.7 separates
 * them; the tests pin both sides of the gap.
 */
const RESTATEMENT_OVERLAP = 0.6;

function alreadySaid(candidate: string, existing: string): boolean {
  const candidateTokens = significantTokens(candidate);
  // Nothing comparable: KEEP the text. Showing the offer twice is a blemish; deleting the
  // only statement of it is a customer-facing failure, so the uncertain case must not drop.
  if (candidateTokens.size === 0) return false;
  const existingTokens = significantTokens(existing);
  let shared = 0;
  for (const token of candidateTokens) if (existingTokens.has(token)) shared += 1;
  return shared / candidateTokens.size >= RESTATEMENT_OVERLAP;
}

/** Never run two sentences together the way "…of your choice Purchase any large…" did. */
function endSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function joinUniqueText(values: Array<string | null | undefined>): string {
  const parts: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    if (parts.some((part) => part === text || alreadySaid(text, part))) continue;
    parts.push(text);
  }
  return parts.map(endSentence).join(" ");
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

function stripTerminalPunctuation(value: string): string {
  return cleanText(value).replace(/[.!?]+$/g, "").trim();
}

function inferDealEligibilityFromLegacyTitle(deal: LocalizedDealDisplayFields): {
  dealType: "PERCENT_OFF_SINGLE_ITEM" | "BUY_ONE_GET_ONE_FREE" | "BUY_ONE_GET_SOMETHING_FREE";
  appliesTo: string;
  discountPercent?: number;
  itemDescription?: string;
  requiredPurchaseQuantity?: number;
  requiredItemDescription?: string;
  freeItemQuantity?: number;
  freeItemDescription?: string;
  freeItemDiscountPercent?: number;
} | null {
  const rawTitle = cleanText(deal.title) || cleanText(deal.title_en);
  if (!rawTitle) return null;

  const percentOff = rawTitle.match(/^get\s+(\d{1,3})\s*%\s+off\s+(?:(?:one|1|a|an)\s+)?(.+)$/i);
  if (percentOff?.[1] && percentOff[2]) {
    const discountPercent = numeric(percentOff[1]);
    const itemDescription = stripTerminalPunctuation(percentOff[2]);
    if (discountPercent != null && discountPercent > 0 && discountPercent <= 100 && itemDescription) {
      return {
        dealType: "PERCENT_OFF_SINGLE_ITEM",
        appliesTo: "SINGLE_ITEM",
        discountPercent,
        itemDescription,
      };
    }
  }

  const sameItem = rawTitle.match(/^buy\s+(?:(?:one|1|a|an)\s+)?(.+?)(?:,|\s+and)?\s+get\s+(?:one|1)\s+free$/i);
  if (sameItem?.[1]) {
    const item = stripTerminalPunctuation(sameItem[1]);
    if (item) {
      return {
        dealType: "BUY_ONE_GET_ONE_FREE",
        appliesTo: "SINGLE_ITEM",
        requiredPurchaseQuantity: 1,
        requiredItemDescription: item,
        freeItemQuantity: 1,
        freeItemDescription: item,
        freeItemDiscountPercent: 100,
      };
    }
  }

  const rewardItem = rawTitle.match(
    /^buy\s+(?:(?:one|1|a|an)\s+)?(.+?)(?:,|\s+and)?\s+get\s+(?:(?:one|1|a|an)\s+)?(?:free\s+(.+)|(.+?)\s+free)$/i,
  );
  const requiredItem = stripTerminalPunctuation(rewardItem?.[1] ?? "");
  const freeItem = stripTerminalPunctuation(rewardItem?.[2] ?? rewardItem?.[3] ?? "");
  if (requiredItem && freeItem) {
    return {
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: requiredItem,
      freeItemQuantity: 1,
      freeItemDescription: freeItem,
      freeItemDiscountPercent: 100,
    };
  }

  return null;
}

export function buildOfferDefinitionFromDealDisplay(
  deal: LocalizedDealDisplayFields | null | undefined,
): OfferDefinitionV1 | null {
  if (!deal) return null;
  const inferred = inferDealEligibilityFromLegacyTitle(deal);
  const type = dealType(deal.deal_type ?? deal.offer_type ?? deal.type) ?? inferred?.dealType ?? null;
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
    const item = cleanText(deal.item_description) || cleanText(inferred?.itemDescription);
    const discount = numeric(deal.discount_percent) ?? numeric(inferred?.discountPercent);
    if (!item || discount == null) return null;
    return buildOfferDefinitionV1({
      ...base,
      dealEligibility: {
        dealType: type,
        appliesTo: cleanText(deal.applies_to) || cleanText(inferred?.appliesTo) || "SINGLE_ITEM",
        discountPercent: discount,
        itemDescription: item,
        itemRetailValueCents: numeric(deal.item_retail_value_cents),
      },
    });
  }

  const requiredItem = cleanText(deal.required_item_description) || cleanText(inferred?.requiredItemDescription);
  const rewardItem = cleanText(deal.free_item_description) || cleanText(inferred?.freeItemDescription) || requiredItem;
  if (!requiredItem || !rewardItem) return null;
  return buildOfferDefinitionV1({
    ...base,
    dealEligibility: {
      dealType: type,
      appliesTo: cleanText(deal.applies_to) || cleanText(inferred?.appliesTo) || "SINGLE_ITEM",
      requiredPurchaseQuantity: positiveInt(deal.required_purchase_quantity) ?? positiveInt(inferred?.requiredPurchaseQuantity) ?? 1,
      requiredItemDescription: requiredItem,
      requiredItemRetailValueCents: numeric(deal.required_item_retail_value_cents),
      freeItemQuantity: positiveInt(deal.free_item_quantity) ?? positiveInt(inferred?.freeItemQuantity) ?? 1,
      freeItemDescription: rewardItem,
      freeItemRetailValueCents: numeric(deal.free_item_retail_value_cents),
      freeItemDiscountPercent: numeric(deal.free_item_discount_percent) ?? numeric(inferred?.freeItemDiscountPercent) ?? 100,
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

export function shouldUseCustomerLocalizedOfferRenderer(locale: SupportedLocale, localizedOfferRendererEnabled: boolean): boolean {
  return localizedOfferRendererEnabled || locale !== "en-US";
}

export function buildLocalizedDealDisplay(params: {
  deal: LocalizedDealDisplayFields;
  locale: SupportedLocale;
  localeResolutionSource: AdLocaleResolutionSource;
  useLocalizedOfferRenderer: boolean;
  fallbackLanguage: string;
}): LocalizedDealDisplay {
  const localizedCreative = customerLocalizationFromDeal(params.deal, params.locale);
  // Customer-only, switch-gated per viewer locale. Undefined (switch off, the
  // default) makes this call byte-identical to before. Never reaches the
  // create/publish bundle path, so stored specs and approval hashes are unchanged.
  const extraDictionary = dealItemTranslationLocales().includes(params.locale)
    ? DEAL_ITEM_TRANSLATION_EXPANSION
    : undefined;
  if (params.useLocalizedOfferRenderer) {
    const definition = buildOfferDefinitionFromDealDisplay(params.deal);
    if (definition) {
      const locked = renderLocalizedOfferFromDefinition(definition, { locale: params.locale, extraDictionary });
      if (localizedCreative) {
        return {
          title: localizedCreative.headline,
          description: joinUniqueText([localizedCreative.supportingCopy, locked.primaryOfferLine, locked.termsLine]),
          renderedLocale: params.locale,
          localeResolutionSource: params.localeResolutionSource,
          source: "approved_localization_storage",
          lockedOfferContent: locked,
          localizedCreative,
        };
      }
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
  const legacyDescription = localizedDealDescription(params.deal, appLanguage || params.fallbackLanguage);
  if (localizedCreative) {
    return {
      title: localizedCreative.headline,
      description: joinUniqueText([localizedCreative.supportingCopy, legacyDescription]),
      renderedLocale: params.locale,
      localeResolutionSource: params.localeResolutionSource,
      source: "approved_localization_storage",
      localizedCreative,
    };
  }
  return {
    title: localizedDealTitle(params.deal, appLanguage),
    description: legacyDescription,
    renderedLocale: params.locale,
    localeResolutionSource: params.localeResolutionSource,
    source: "legacy_localized_fields",
  };
}
