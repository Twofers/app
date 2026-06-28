import type { SupportedLocale } from "./supported-locales.ts";

export type AdLocalizationStatus =
  | "source_creative"
  | "persuasive_transcreation"
  | "deterministic_fallback";

export type AdLocalizationRepairStatus =
  | "not_required"
  | "not_needed"
  | "not_attempted"
  | "attempted_pass"
  | "attempted_failed"
  | "skipped_non_repairable";

export type AdLocalizationQaDecision =
  | "not_required"
  | "pass"
  | "repair"
  | "block"
  | "unavailable";

export type AdTranslationQaHardFailReason =
  | "WRONG_LANGUAGE"
  | "OFFER_FACT_DRIFT"
  | "UNSUPPORTED_CLAIM"
  | "PROTECTED_TERM_CHANGED"
  | "BANNED_SHORTHAND"
  | "MEANING_CHANGED"
  | "MOBILE_COPY_TOO_LONG"
  | "UNNATURAL_TARGET_LANGUAGE"
  | "INCOMPLETE_FIELDS"
  | "UNEXPECTED_LANGUAGE_MIXING";

export type AdTranslationQaScores = {
  semanticParity: number;
  naturalness: number;
  merchantTone: number;
  clarity: number;
  mobileReadability: number;
};

export type AdTranslationQaResult = {
  locale: SupportedLocale;
  decision: Exclude<AdLocalizationQaDecision, "not_required">;
  hardFailReasons: AdTranslationQaHardFailReason[];
  scores: AdTranslationQaScores;
  conciseFeedback: string[];
};

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
  repairAttempted: boolean;
  repairStatus: AdLocalizationRepairStatus;
  repairReasonCodes: string[];
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
