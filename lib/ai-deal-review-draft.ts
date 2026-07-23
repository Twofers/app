import { buildDeterministicAdLocalizationBundle } from "./ad-localization";
import type { GeneratedAd } from "./ad-variants";
import type { OfferDefinitionV1 } from "./offer-definition";
import type { PosterDraftV1 } from "./poster/posterTypes";
import { supportedLocaleOrDefault, type SupportedLocale } from "./supported-locales";

export type AiDealReviewDraftInput = {
  generatedAd: GeneratedAd | null;
  title: string;
  promoLine: string;
  ctaText: string;
  poster: PosterDraftV1 | null;
  sourceLocale: SupportedLocale | string | null | undefined;
  offerDefinition: OfferDefinitionV1 | null;
};

export type AiDealReviewDraft = {
  ad: GeneratedAd | null;
  sourceCreativeChanged: boolean;
};

function cleanText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

/**
 * Produces the single ad snapshot used by owner preview, approval, recovery, and
 * publish. Merchant-edited fields always win. If source-language creative copy
 * changed, verified target-language copy is no longer valid, so it is replaced
 * with the deterministic, fact-locked localization fallback before approval.
 */
export function buildAiDealReviewDraft(input: AiDealReviewDraftInput): AiDealReviewDraft {
  if (!input.generatedAd) return { ad: null, sourceCreativeChanged: false };

  const sourceLocale = supportedLocaleOrDefault(input.sourceLocale);
  const headline = cleanText(input.title);
  const supportingCopy = cleanText(input.promoLine);
  const cta = cleanText(input.ctaText);
  const existingBundle = input.generatedAd.localization_bundle ?? null;
  const existingSource = existingBundle?.localizations[sourceLocale] ?? null;
  const sourceCreativeChanged = Boolean(
    existingBundle &&
      (existingBundle.sourceLocale !== sourceLocale ||
        cleanText(existingSource?.headline) !== headline ||
        cleanText(existingSource?.supportingCopy) !== supportingCopy),
  );

  let localizationBundle = existingBundle;
  let localizationStatus = input.generatedAd.localization_status ?? null;
  if ((!existingBundle || sourceCreativeChanged) && input.offerDefinition) {
    const imageAltText =
      cleanText(existingSource?.imageAltText) ||
      cleanText(existingBundle?.localizations[existingBundle.sourceLocale]?.imageAltText) ||
      `${input.offerDefinition.merchantName} offer image. ${input.offerDefinition.canonicalOfferSentence}`;
    localizationBundle = buildDeterministicAdLocalizationBundle({
      sourceLocale,
      sourceCreative: { headline, supportingCopy, imageAltText },
      offerDefinition: input.offerDefinition,
    });
    localizationStatus = {
      source_locale: localizationBundle.sourceLocale,
      localization_bundle_hash: localizationBundle.localizationBundleHash,
      deterministic_fallback_locales: localizationBundle.deterministicFallbackLocales,
      transcreation_provider: "deterministic",
      transcreation_model: "none",
      transcreation_skipped_reason: sourceCreativeChanged
        ? "source_creative_edited"
        : "missing_localization_bundle",
      semantic_qa_provider: "deterministic",
      semantic_qa_model: "none",
      semantic_qa_skipped_reason: sourceCreativeChanged
        ? "source_creative_edited"
        : "missing_localization_bundle",
      repair_target_locales: [],
    };
  }

  return {
    ad: {
      ...input.generatedAd,
      headline,
      subheadline: supportingCopy,
      short_description: supportingCopy,
      cta,
      poster: input.poster,
      localization_bundle: localizationBundle,
      localization_status: localizationStatus,
    },
    sourceCreativeChanged,
  };
}
