import {
  SUPPORTED_LOCALES,
  enabledSupportedLocales,
  supportedLocaleOrDefault,
  type SupportedLocale,
} from "./supported-locales";

export type MerchantTranslationReviewMode = "automatic_verified" | "review_each_locale";

export type MerchantLocalizationProfile = {
  businessId: string;
  preferredAuthoringLocale: SupportedLocale;
  enabledConsumerLocales: SupportedLocale[];
  translationReviewMode: MerchantTranslationReviewMode;
  preserveBusinessName: boolean;
  defaultDoNotTranslateTerms: string[];
  approvedLocalizedBusinessNames?: Partial<Record<SupportedLocale, string>>;
  profileVersion: string;
  updatedAt: string;
};

export const MERCHANT_LOCALIZATION_PROFILE_VERSION = "merchant-localization-profile-v1";

export function buildDefaultMerchantLocalizationProfile(params: {
  businessId: string;
  preferredAuthoringLocale?: string | null;
  enabledConsumerLocales?: readonly string[] | null;
  defaultDoNotTranslateTerms?: readonly string[] | null;
  approvedLocalizedBusinessNames?: Partial<Record<SupportedLocale, string>>;
  updatedAt?: string;
}): MerchantLocalizationProfile {
  return {
    businessId: params.businessId.trim(),
    preferredAuthoringLocale: supportedLocaleOrDefault(params.preferredAuthoringLocale),
    enabledConsumerLocales: enabledSupportedLocales(params.enabledConsumerLocales ?? SUPPORTED_LOCALES),
    translationReviewMode: "automatic_verified",
    preserveBusinessName: true,
    defaultDoNotTranslateTerms: [...new Set((params.defaultDoNotTranslateTerms ?? []).map((term) => term.trim()).filter(Boolean))],
    ...(params.approvedLocalizedBusinessNames ? { approvedLocalizedBusinessNames: params.approvedLocalizedBusinessNames } : {}),
    profileVersion: MERCHANT_LOCALIZATION_PROFILE_VERSION,
    updatedAt: params.updatedAt ?? new Date(0).toISOString(),
  };
}

export function isMerchantLocalizationProfile(value: unknown): value is MerchantLocalizationProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<MerchantLocalizationProfile>;
  return (
    typeof profile.businessId === "string" &&
    typeof profile.preferredAuthoringLocale === "string" &&
    Array.isArray(profile.enabledConsumerLocales) &&
    profile.translationReviewMode === "automatic_verified" &&
    profile.preserveBusinessName === true &&
    Array.isArray(profile.defaultDoNotTranslateTerms) &&
    profile.profileVersion === MERCHANT_LOCALIZATION_PROFILE_VERSION &&
    typeof profile.updatedAt === "string"
  );
}
