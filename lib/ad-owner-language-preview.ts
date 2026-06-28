import type { GeneratedAd } from "./ad-variants";
import { DEFAULT_AD_LOCALIZED_CTA_LABELS } from "./ad-locale-presentation-resolver";
import type {
  AdLocalizationQaDecision,
  AdLocalizationStatus,
} from "./ad-localization-schema";
import {
  buildApprovedAdCopy,
  type ApprovedAdCopy,
  type ImmutableOfferFacts,
} from "./ad-render-content";
import {
  buildLockedOfferContent,
  renderAuthoritativeOfferFromDefinition,
} from "./authoritative-offer-renderer";
import {
  renderLocalizedOfferFromDefinition,
} from "./localized-offer-renderer";
import type { OfferDefinitionV1 } from "./offer-definition";
import {
  supportedLocaleOrDefault,
  type SupportedLocale,
} from "./supported-locales";

export type OwnerLanguagePreview = {
  locale: SupportedLocale;
  sourceLocale: SupportedLocale;
  copy: ApprovedAdCopy;
  offerFacts: ImmutableOfferFacts;
  headline: string;
  body: string;
  offerLine: string;
  termsLine: string;
  cta: string;
  imageAltText: string;
  hasVerifiedLocalizationBundle: boolean;
  translationStatus: AdLocalizationStatus | null;
  qaDecision: AdLocalizationQaDecision | null;
};

export type BuildOwnerLanguagePreviewInput = {
  generatedAd?: GeneratedAd | null;
  offerDefinition?: OfferDefinitionV1 | null;
  sourceLocale?: string | null;
  previewLocale?: string | null;
  localizedPreviewEnabled?: boolean;
  fallbackOfferLine?: string | null;
  fallbackTermsLine?: string | null;
  fallbackCtaLabel?: string | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function sentenceJoin(parts: readonly string[]): string {
  return parts.filter(Boolean).join(". ");
}

function offerFactsFor(input: {
  offerDefinition?: OfferDefinitionV1 | null;
  localizedPreviewEnabled: boolean;
  previewLocale: SupportedLocale;
  fallbackOfferLine?: string | null;
  fallbackTermsLine?: string | null;
}): ImmutableOfferFacts {
  if (input.offerDefinition && input.localizedPreviewEnabled) {
    return renderLocalizedOfferFromDefinition(input.offerDefinition, { locale: input.previewLocale });
  }
  if (input.offerDefinition) {
    return renderAuthoritativeOfferFromDefinition(input.offerDefinition);
  }
  return buildLockedOfferContent({
    primaryOfferLine: input.fallbackOfferLine,
    termsLine: input.fallbackTermsLine,
  });
}

function localizedCtaLabel(params: {
  locale: SupportedLocale;
  sourceLocale: SupportedLocale;
  localizedPreviewEnabled: boolean;
  generatedCta?: string | null;
  fallbackCtaLabel?: string | null;
}): string {
  const generatedCta = clean(params.generatedCta);
  const fallbackCta = clean(params.fallbackCtaLabel);
  if (!params.localizedPreviewEnabled || params.locale === params.sourceLocale) {
    return generatedCta || fallbackCta || DEFAULT_AD_LOCALIZED_CTA_LABELS[params.locale];
  }
  return DEFAULT_AD_LOCALIZED_CTA_LABELS[params.locale];
}

export function buildOwnerLanguagePreview(
  input: BuildOwnerLanguagePreviewInput,
): OwnerLanguagePreview {
  const bundle = input.localizedPreviewEnabled ? input.generatedAd?.localization_bundle ?? null : null;
  const sourceLocale = supportedLocaleOrDefault(bundle?.sourceLocale ?? input.sourceLocale);
  const previewLocale = supportedLocaleOrDefault(input.previewLocale ?? sourceLocale);
  const localization = bundle?.localizations[previewLocale] ?? null;
  const offerFacts = offerFactsFor({
    offerDefinition: input.offerDefinition,
    localizedPreviewEnabled: input.localizedPreviewEnabled === true,
    previewLocale,
    fallbackOfferLine: localization?.exactOfferLine || input.fallbackOfferLine,
    fallbackTermsLine: localization?.termsLine || input.fallbackTermsLine,
  });
  const offerLine = clean(localization?.exactOfferLine) || offerFacts.primaryOfferLine;
  const termsLine = clean(localization?.termsLine) || offerFacts.termsLine;
  const headline =
    clean(localization?.headline) ||
    clean(input.generatedAd?.headline) ||
    offerFacts.primaryOfferLine;
  const body =
    clean(localization?.supportingCopy) ||
    clean(input.generatedAd?.subheadline) ||
    clean(input.generatedAd?.short_description) ||
    termsLine;
  const cta = localizedCtaLabel({
    locale: previewLocale,
    sourceLocale,
    localizedPreviewEnabled: input.localizedPreviewEnabled === true,
    generatedCta: input.generatedAd?.cta,
    fallbackCtaLabel: input.fallbackCtaLabel,
  });
  const imageAltText =
    clean(localization?.imageAltText) ||
    clean(input.generatedAd?.headline) ||
    sentenceJoin([offerFacts.primaryOfferLine, termsLine]);
  const copy = {
    ...buildApprovedAdCopy({
      headline,
      supportingCopy: body,
      ctaLabel: cta,
      fallbackHeadline: offerFacts.primaryOfferLine,
    }),
    imageAltText,
  };

  return {
    locale: previewLocale,
    sourceLocale,
    copy,
    offerFacts,
    headline: copy.headline,
    body: copy.supportingCopy ?? "",
    offerLine,
    termsLine,
    cta: copy.ctaLabel,
    imageAltText,
    hasVerifiedLocalizationBundle: Boolean(bundle?.localizations[previewLocale]),
    translationStatus: localization?.translationStatus ?? null,
    qaDecision: localization?.qaDecision ?? null,
  };
}
