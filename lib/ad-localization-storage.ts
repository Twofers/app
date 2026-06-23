import type {
  AdLocalizationBundle,
  AdLocalizationQaDecision,
  AdLocalizationRepairStatus,
  AdLocalizationStatus,
  AdLocalizedCreative,
} from "./ad-localization-schema";
import type { AdPresentationLocaleOverride } from "./ad-presentation-spec";
import {
  LOCALIZED_OFFER_RENDERER_VERSION,
  renderLocalizedOfferBundleFromDefinition,
} from "./localized-offer-renderer";
import type { OfferDefinitionV1 } from "./offer-definition";
import {
  enabledSupportedLocales,
  type SupportedLocale,
} from "./supported-locales";

export const AD_LOCALIZATION_STORAGE_SCHEMA_VERSION = 1;
export const AD_LOCALIZATION_STORAGE_VERSION = "twofer-ad-localization-storage-v1";

export type AdLocalizationProviderStatus = {
  transcreation_provider?: string | null;
  transcreation_model?: string | null;
  semantic_qa_provider?: string | null;
  semantic_qa_model?: string | null;
  semantic_qa_skipped_reason?: string | null;
  repair_target_locales?: readonly SupportedLocale[] | null;
};

export type AdLocalizationStorageRow = {
  locale: SupportedLocale;
  sourceLocale: SupportedLocale;
  headline: string;
  supportingCopy: string | null;
  imageAltText: string;
  sourceCopyHash: string;
  localizationHash: string;
  translationStatus: AdLocalizationStatus;
  qaDecision: AdLocalizationQaDecision;
  qaReasonCodes: string[];
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  preservedTerms: string[];
  repairAttempted: boolean;
  repairStatus: AdLocalizationRepairStatus;
  repairReasonCodes: string[];
};

export type AdLocalizationTranslationQaSummary = {
  translationStatus: AdLocalizationStatus;
  qaDecision: AdLocalizationQaDecision;
  qaReasonCodes: string[];
  repairAttempted: boolean;
  repairStatus: AdLocalizationRepairStatus;
  repairReasonCodes: string[];
};

export type LocalizedTermSnapshotForPublish = {
  schemaVersion: typeof AD_LOCALIZATION_STORAGE_SCHEMA_VERSION;
  rendererVersion: typeof LOCALIZED_OFFER_RENDERER_VERSION;
  locales: Partial<Record<SupportedLocale, {
    templateId: string;
    templateVersion: string;
    localizedTermSnapshotIds: string[];
  }>>;
};

export type OfferVersionPublishLocalizationSnapshot = {
  schemaVersion: typeof AD_LOCALIZATION_STORAGE_SCHEMA_VERSION;
  storageVersion: typeof AD_LOCALIZATION_STORAGE_VERSION;
  sourceLocale: SupportedLocale;
  enabledLocales: SupportedLocale[];
  sourceCreativeHash: string;
  localizationBundleHash: string;
  deterministicFallbackLocales: SupportedLocale[];
  localeRendererVersion: typeof LOCALIZED_OFFER_RENDERER_VERSION;
  localizedTermSnapshot: LocalizedTermSnapshotForPublish;
  localePresentationOverrides?: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>>;
  translationQaSummary: Partial<Record<SupportedLocale, AdLocalizationTranslationQaSummary>>;
  semanticQaSummary: {
    provider: string | null;
    model: string | null;
    skippedReason: string | null;
    repairTargetLocales: SupportedLocale[];
  };
  localizations: Partial<Record<SupportedLocale, AdLocalizationStorageRow>>;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanOptionalText(value: unknown): string | null {
  const clean = cleanText(value);
  return clean || null;
}

function uniqueClean(values: readonly string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map(cleanText).filter(Boolean))];
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

function localizationRowHash(input: Omit<AdLocalizationStorageRow, "localizationHash">): string {
  return `adlocrow_${hashString(stableJson(input))}`;
}

function providerForCreative(
  creative: AdLocalizedCreative,
  status?: AdLocalizationProviderStatus | null,
): { provider: string | null; model: string | null; promptVersion: string | null } {
  if (creative.translationStatus !== "persuasive_transcreation") {
    return { provider: null, model: null, promptVersion: null };
  }
  return {
    provider: cleanOptionalText(status?.transcreation_provider),
    model: cleanOptionalText(status?.transcreation_model),
    promptVersion: null,
  };
}

function storageSupportingCopy(creative: AdLocalizedCreative): string | null {
  if (creative.translationStatus === "deterministic_fallback") return null;
  const supportingCopy = cleanText(creative.supportingCopy);
  if (!supportingCopy) return null;
  const exactOfferLine = cleanText(creative.exactOfferLine);
  const termsLine = cleanText(creative.termsLine);
  if (supportingCopy === exactOfferLine || supportingCopy === termsLine) return null;
  return supportingCopy;
}

function buildStorageRow(params: {
  locale: SupportedLocale;
  bundle: AdLocalizationBundle;
  creative: AdLocalizedCreative;
  providerStatus?: AdLocalizationProviderStatus | null;
}): AdLocalizationStorageRow {
  const provider = providerForCreative(params.creative, params.providerStatus);
  const withoutHash = {
    locale: params.locale,
    sourceLocale: params.bundle.sourceLocale,
    headline: cleanText(params.creative.headline),
    supportingCopy: storageSupportingCopy(params.creative),
    imageAltText: cleanText(params.creative.imageAltText),
    sourceCopyHash: params.bundle.sourceCreativeHash,
    translationStatus: params.creative.translationStatus,
    qaDecision: params.creative.qaDecision,
    qaReasonCodes: uniqueClean(params.creative.qaReasonCodes),
    provider: provider.provider,
    model: provider.model,
    promptVersion: provider.promptVersion,
    preservedTerms: uniqueClean(params.creative.preservedTerms),
    repairAttempted: params.creative.repairAttempted === true,
    repairStatus: params.creative.repairStatus,
    repairReasonCodes: uniqueClean(params.creative.repairReasonCodes),
  };
  return {
    ...withoutHash,
    localizationHash: localizationRowHash(withoutHash),
  };
}

export function buildAdLocalizationStorageRows(input: {
  bundle: AdLocalizationBundle;
  enabledLocales?: readonly SupportedLocale[] | null;
  providerStatus?: AdLocalizationProviderStatus | null;
}): Partial<Record<SupportedLocale, AdLocalizationStorageRow>> {
  const enabledLocales = enabledSupportedLocales(input.enabledLocales);
  const rows: Partial<Record<SupportedLocale, AdLocalizationStorageRow>> = {};
  for (const locale of enabledLocales) {
    const creative = input.bundle.localizations[locale];
    if (!creative) continue;
    rows[locale] = buildStorageRow({
      locale,
      bundle: input.bundle,
      creative,
      providerStatus: input.providerStatus,
    });
  }
  return rows;
}

export function buildLocalizedTermSnapshotForPublish(input: {
  offerDefinition: OfferDefinitionV1;
  enabledLocales?: readonly SupportedLocale[] | null;
}): LocalizedTermSnapshotForPublish {
  const enabledLocales = enabledSupportedLocales(input.enabledLocales);
  const rendered = renderLocalizedOfferBundleFromDefinition(input.offerDefinition);
  const locales: LocalizedTermSnapshotForPublish["locales"] = {};
  for (const locale of enabledLocales) {
    const renderedLocale = rendered[locale];
    locales[locale] = {
      templateId: renderedLocale.templateId,
      templateVersion: renderedLocale.templateVersion,
      localizedTermSnapshotIds: [...renderedLocale.localizedTermSnapshotIds],
    };
  }
  return {
    schemaVersion: AD_LOCALIZATION_STORAGE_SCHEMA_VERSION,
    rendererVersion: LOCALIZED_OFFER_RENDERER_VERSION,
    locales,
  };
}

function translationQaSummary(
  rows: Partial<Record<SupportedLocale, AdLocalizationStorageRow>>,
): Partial<Record<SupportedLocale, AdLocalizationTranslationQaSummary>> {
  return Object.fromEntries(
    Object.entries(rows).map(([locale, row]) => [
      locale,
      {
        translationStatus: row.translationStatus,
        qaDecision: row.qaDecision,
        qaReasonCodes: row.qaReasonCodes,
        repairAttempted: row.repairAttempted,
        repairStatus: row.repairStatus,
        repairReasonCodes: row.repairReasonCodes,
      },
    ]),
  ) as Partial<Record<SupportedLocale, AdLocalizationTranslationQaSummary>>;
}

function cleanLocalePresentationOverrides(
  overrides: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>> | null | undefined,
  enabledLocales: readonly SupportedLocale[],
): Partial<Record<SupportedLocale, AdPresentationLocaleOverride>> | undefined {
  if (!overrides) return undefined;
  const out: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>> = {};
  for (const locale of enabledLocales) {
    const override = overrides[locale];
    if (override) out[locale] = override;
  }
  return Object.keys(out).length ? out : undefined;
}

export function buildOfferVersionLocalizationSnapshot(input: {
  bundle: AdLocalizationBundle | null | undefined;
  offerDefinition: OfferDefinitionV1;
  enabledLocales?: readonly SupportedLocale[] | null;
  providerStatus?: AdLocalizationProviderStatus | null;
  localePresentationOverrides?: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>> | null;
}): OfferVersionPublishLocalizationSnapshot | null {
  if (!input.bundle) return null;
  const enabledLocales = enabledSupportedLocales(input.enabledLocales);
  const rows = buildAdLocalizationStorageRows({
    bundle: input.bundle,
    enabledLocales,
    providerStatus: input.providerStatus,
  });
  if (Object.keys(rows).length === 0) return null;
  const localePresentationOverrides = cleanLocalePresentationOverrides(
    input.localePresentationOverrides,
    enabledLocales,
  );
  return {
    schemaVersion: AD_LOCALIZATION_STORAGE_SCHEMA_VERSION,
    storageVersion: AD_LOCALIZATION_STORAGE_VERSION,
    sourceLocale: input.bundle.sourceLocale,
    enabledLocales,
    sourceCreativeHash: input.bundle.sourceCreativeHash,
    localizationBundleHash: input.bundle.localizationBundleHash,
    deterministicFallbackLocales: input.bundle.deterministicFallbackLocales.filter((locale) =>
      enabledLocales.includes(locale),
    ),
    localeRendererVersion: LOCALIZED_OFFER_RENDERER_VERSION,
    localizedTermSnapshot: buildLocalizedTermSnapshotForPublish({
      offerDefinition: input.offerDefinition,
      enabledLocales,
    }),
    ...(localePresentationOverrides ? { localePresentationOverrides } : {}),
    translationQaSummary: translationQaSummary(rows),
    semanticQaSummary: {
      provider: cleanOptionalText(input.providerStatus?.semantic_qa_provider),
      model: cleanOptionalText(input.providerStatus?.semantic_qa_model),
      skippedReason: cleanOptionalText(input.providerStatus?.semantic_qa_skipped_reason),
      repairTargetLocales: [...new Set(input.providerStatus?.repair_target_locales ?? [])],
    },
    localizations: rows,
  };
}
