import { renderLocalizedOfferBundleFromDefinition } from "./localized-offer-renderer";
import type { OfferDefinitionV1 } from "./offer-definition";

export type DealTranslationLocale = "en" | "es" | "ko";

export type DealTranslationResult = {
  source_locale: DealTranslationLocale;
  title_en: string;
  title_es: string;
  title_ko: string;
  description_en: string;
  description_es: string;
  description_ko: string;
};

export function buildDealTranslationFallback(input: {
  source_locale: DealTranslationLocale;
  title: string;
  description: string;
  offerDefinition?: OfferDefinitionV1 | null;
}): DealTranslationResult {
  const title = input.title.trim();
  const description = input.description.trim();
  const result = {
    source_locale: input.source_locale,
    title_en: input.source_locale === "en" ? title : "",
    title_es: input.source_locale === "es" ? title : "",
    title_ko: input.source_locale === "ko" ? title : "",
    description_en: input.source_locale === "en" ? description : "",
    description_es: input.source_locale === "es" ? description : "",
    description_ko: input.source_locale === "ko" ? description : "",
  };
  if (!input.offerDefinition) return result;

  const localized = renderLocalizedOfferBundleFromDefinition(input.offerDefinition);
  if (input.source_locale !== "en") {
    result.title_en = localized["en-US"].primaryOfferLine;
    result.description_en = localized["en-US"].termsLine;
  }
  if (input.source_locale !== "es") {
    result.title_es = localized["es-US"].primaryOfferLine;
    result.description_es = localized["es-US"].termsLine;
  }
  if (input.source_locale !== "ko") {
    result.title_ko = localized["ko-KR"].primaryOfferLine;
    result.description_ko = localized["ko-KR"].termsLine;
  }
  return result;
}
