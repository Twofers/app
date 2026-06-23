import type { OfferDefinitionV1OfferType } from "./offer-definition.ts";
import type { SupportedLocale } from "./supported-locales.ts";

export type OfferLocaleTemplateReviewStatus =
  | "internal_owner_recorded"
  | "needs_native_review";

export type OfferLocaleTemplate = {
  locale: SupportedLocale;
  offerType: OfferDefinitionV1OfferType;
  templateId: string;
  templateVersion: string;
  reviewStatus: OfferLocaleTemplateReviewStatus;
};

export const LOCALIZED_OFFER_TEMPLATE_VERSION = "localized-offer-template-v1";

const TEMPLATE_BY_LOCALE_AND_TYPE: Record<SupportedLocale, Record<OfferDefinitionV1OfferType, OfferLocaleTemplate>> = {
  "en-US": {
    buy_one_get_one: {
      locale: "en-US",
      offerType: "buy_one_get_one",
      templateId: "en-US.offer.same-item-free",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "internal_owner_recorded",
    },
    buy_one_get_reward_item: {
      locale: "en-US",
      offerType: "buy_one_get_reward_item",
      templateId: "en-US.offer.reward-item-free",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "internal_owner_recorded",
    },
    percent_off_single_item: {
      locale: "en-US",
      offerType: "percent_off_single_item",
      templateId: "en-US.offer.percent-off-single-item",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "internal_owner_recorded",
    },
  },
  "es-US": {
    buy_one_get_one: {
      locale: "es-US",
      offerType: "buy_one_get_one",
      templateId: "es-US.offer.same-item-free",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "needs_native_review",
    },
    buy_one_get_reward_item: {
      locale: "es-US",
      offerType: "buy_one_get_reward_item",
      templateId: "es-US.offer.reward-item-free",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "needs_native_review",
    },
    percent_off_single_item: {
      locale: "es-US",
      offerType: "percent_off_single_item",
      templateId: "es-US.offer.percent-off-single-item",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "needs_native_review",
    },
  },
  "ko-KR": {
    buy_one_get_one: {
      locale: "ko-KR",
      offerType: "buy_one_get_one",
      templateId: "ko-KR.offer.counter-free-fallback.same-item-free",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "needs_native_review",
    },
    buy_one_get_reward_item: {
      locale: "ko-KR",
      offerType: "buy_one_get_reward_item",
      templateId: "ko-KR.offer.counter-free-fallback.reward-item-free",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "needs_native_review",
    },
    percent_off_single_item: {
      locale: "ko-KR",
      offerType: "percent_off_single_item",
      templateId: "ko-KR.offer.counter-free-fallback.percent-off-single-item",
      templateVersion: LOCALIZED_OFFER_TEMPLATE_VERSION,
      reviewStatus: "needs_native_review",
    },
  },
};

export function getOfferLocaleTemplate(
  locale: SupportedLocale,
  offerType: OfferDefinitionV1OfferType,
): OfferLocaleTemplate {
  return TEMPLATE_BY_LOCALE_AND_TYPE[locale][offerType];
}

export function allOfferLocaleTemplates(): OfferLocaleTemplate[] {
  return Object.values(TEMPLATE_BY_LOCALE_AND_TYPE).flatMap((byType) => Object.values(byType));
}
