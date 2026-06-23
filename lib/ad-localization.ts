import {
  renderLocalizedOfferFromDefinition,
} from "./localized-offer-renderer";
import type { OfferDefinitionV1 } from "./offer-definition";
import {
  SUPPORTED_LOCALES,
  supportedLocaleOrDefault,
  type SupportedLocale,
} from "./supported-locales";
import { validateAdTranscreationDeterministically } from "./ad-translation-qa";
import type {
  AdLocalizationBundle,
  AdLocalizedCreative,
  AdTranslationQaResult,
  SourceAdCreative,
} from "./ad-localization-schema";

const FALLBACK_HEADLINE: Record<SupportedLocale, string> = {
  "en-US": "Local deal",
  "es-US": "Oferta local",
  "ko-KR": "로컬 딜",
};

const FALLBACK_IMAGE_ALT_PREFIX: Record<SupportedLocale, string> = {
  "en-US": "Deal image for",
  "es-US": "Imagen de la oferta de",
  "ko-KR": "딜 이미지:",
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function uniqueClean(values: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of values ?? []) {
    const clean = cleanText(raw);
    if (clean && !out.some((value) => value.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out;
}

function defaultProtectedTerms(definition: OfferDefinitionV1): string[] {
  return uniqueClean([
    definition.merchantName,
    definition.locationName,
    ...definition.qualifyingItems.map((item) => item.displayName),
    ...definition.reward.displayNames,
  ]);
}

function termsPresentInCreative(terms: readonly string[], creative: Pick<AdLocalizedCreative, "headline" | "supportingCopy" | "imageAltText" | "exactOfferLine" | "termsLine">): string[] {
  const haystack = [
    creative.headline,
    creative.supportingCopy,
    creative.imageAltText,
    creative.exactOfferLine,
    creative.termsLine,
  ].join(" ").toLowerCase();
  return terms.filter((term) => haystack.includes(term.toLowerCase()));
}

function sourceHash(input: {
  sourceLocale: SupportedLocale;
  sourceCreative: SourceAdCreative;
}): string {
  return `adsrc_${hashString(stableJson(input))}`;
}

function bundleHash(input: Omit<AdLocalizationBundle, "localizationBundleHash">): string {
  return `adloc_${hashString(stableJson(input))}`;
}

export function buildDeterministicAdLocalizationBundle(input: {
  sourceLocale: string | null | undefined;
  sourceCreative: SourceAdCreative;
  offerDefinition: OfferDefinitionV1;
  protectedTerms?: readonly string[] | null;
  enabledLocales?: readonly SupportedLocale[] | null;
}): AdLocalizationBundle {
  return buildQaCheckedAdLocalizationBundle(input);
}

function deterministicFallbackReasonCodes(qa: AdTranslationQaResult | null): string[] {
  return [
    "DETERMINISTIC_TARGET_FALLBACK",
    ...(qa?.hardFailReasons ?? []),
  ];
}

export function buildQaCheckedAdLocalizationBundle(input: {
  sourceLocale: string | null | undefined;
  sourceCreative: SourceAdCreative;
  offerDefinition: OfferDefinitionV1;
  protectedTerms?: readonly string[] | null;
  enabledLocales?: readonly SupportedLocale[] | null;
  targetCreatives?: Partial<Record<SupportedLocale, SourceAdCreative | null>> | null;
}): AdLocalizationBundle {
  const sourceLocale = supportedLocaleOrDefault(input.sourceLocale);
  const enabledLocales = input.enabledLocales?.length ? [...input.enabledLocales] : [...SUPPORTED_LOCALES];
  const protectedTerms = uniqueClean([
    ...defaultProtectedTerms(input.offerDefinition),
    ...(input.protectedTerms ?? []),
  ]);
  const sourceCreativeHash = sourceHash({
    sourceLocale,
    sourceCreative: {
      headline: cleanText(input.sourceCreative.headline),
      supportingCopy: cleanText(input.sourceCreative.supportingCopy),
      imageAltText: cleanText(input.sourceCreative.imageAltText),
    },
  });
  const localizations = Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => {
      const locked = renderLocalizedOfferFromDefinition(input.offerDefinition, { locale });
      const isSource = locale === sourceLocale;
      const targetCreative = !isSource ? input.targetCreatives?.[locale] ?? null : null;
      const qa = targetCreative
        ? validateAdTranscreationDeterministically({
            sourceLocale,
            targetLocale: locale,
            sourceCreative: input.sourceCreative,
            targetCreative,
            offerDefinition: input.offerDefinition,
            protectedTerms,
          })
        : null;
      const useTranscreation = Boolean(qa && qa.decision === "pass" && targetCreative);
      const base = {
        locale,
        headline: isSource
          ? cleanText(input.sourceCreative.headline) || locked.primaryOfferLine
          : useTranscreation
            ? cleanText(targetCreative?.headline) || FALLBACK_HEADLINE[locale]
            : FALLBACK_HEADLINE[locale],
        supportingCopy: isSource
          ? cleanText(input.sourceCreative.supportingCopy) || locked.termsLine
          : useTranscreation
            ? cleanText(targetCreative?.supportingCopy) || locked.primaryOfferLine
            : locked.primaryOfferLine,
        imageAltText: isSource
          ? cleanText(input.sourceCreative.imageAltText) || `${FALLBACK_IMAGE_ALT_PREFIX[locale]} ${input.offerDefinition.merchantName}`
          : useTranscreation
            ? cleanText(targetCreative?.imageAltText) || `${FALLBACK_IMAGE_ALT_PREFIX[locale]} ${input.offerDefinition.merchantName}`
            : `${FALLBACK_IMAGE_ALT_PREFIX[locale]} ${input.offerDefinition.merchantName}`,
        exactOfferLine: locked.primaryOfferLine,
        termsLine: locked.termsLine,
        preservedTerms: [] as string[],
        translationStatus: isSource
          ? "source_creative" as const
          : useTranscreation
            ? "persuasive_transcreation" as const
            : "deterministic_fallback" as const,
        qaDecision: isSource ? "not_required" as const : "pass" as const,
        qaReasonCodes: isSource ? [] : useTranscreation ? [] : deterministicFallbackReasonCodes(qa),
      };
      return [
        locale,
        {
          ...base,
          preservedTerms: termsPresentInCreative(protectedTerms, base),
        },
      ];
    }),
  ) as Record<SupportedLocale, AdLocalizedCreative>;

  const withoutHash = {
    sourceLocale,
    sourceCreativeHash,
    deterministicFallbackLocales: enabledLocales.filter(
      (locale) => locale !== sourceLocale && localizations[locale].translationStatus === "deterministic_fallback",
    ),
    localizations,
  };
  return {
    ...withoutHash,
    localizationBundleHash: bundleHash(withoutHash),
  };
}
