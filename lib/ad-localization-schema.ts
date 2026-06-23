import type { SupportedLocale } from "./supported-locales";

export type AdLocalizationStatus =
  | "source_creative"
  | "persuasive_transcreation"
  | "deterministic_fallback";

export type AdLocalizationQaDecision =
  | "not_required"
  | "pass"
  | "repair"
  | "block"
  | "unavailable";

export type AdLocalizedCreative = {
  locale: SupportedLocale;
  headline: string;
  supportingCopy: string;
  imageAltText: string;
  exactOfferLine: string;
  termsLine: string;
  preservedTerms: string[];
  translationStatus: AdLocalizationStatus;
  qaDecision: AdLocalizationQaDecision;
  qaReasonCodes: string[];
};

export type AdLocalizationBundle = {
  sourceLocale: SupportedLocale;
  sourceCreativeHash: string;
  localizationBundleHash: string;
  deterministicFallbackLocales: SupportedLocale[];
  localizations: Record<SupportedLocale, AdLocalizedCreative>;
};

export type SourceAdCreative = {
  headline: string;
  supportingCopy?: string | null;
  imageAltText: string;
};
