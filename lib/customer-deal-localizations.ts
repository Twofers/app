import { logPostgrestError } from "./supabase-client-log";
import { supabase } from "./supabase";
import type { SupportedLocale } from "./supported-locales";

export type CustomerDealLocalization = {
  dealId: string;
  offerVersionId?: string | null;
  locale: SupportedLocale;
  sourceLocale?: SupportedLocale | null;
  headline: string;
  supportingCopy?: string | null;
  imageAltText?: string | null;
  localizationHash: string;
  localizationBundleHash?: string | null;
  translationStatus: "source_creative" | "persuasive_transcreation" | "deterministic_fallback";
  qaDecision: "not_required" | "pass" | "repair" | "block" | "unavailable";
  qaReasonCodes?: string[];
  deterministicFallback?: boolean;
  localeRendererVersion?: string | null;
  localizedTermSnapshot?: unknown;
  localePresentationOverrides?: unknown;
};

type CustomerDealLocalizationRpcRow = {
  deal_id?: string | null;
  offer_version_id?: string | null;
  locale?: string | null;
  source_locale?: string | null;
  headline?: string | null;
  supporting_copy?: string | null;
  image_alt_text?: string | null;
  localization_hash?: string | null;
  localization_bundle_hash?: string | null;
  translation_status?: string | null;
  qa_decision?: string | null;
  qa_reason_codes?: unknown;
  deterministic_fallback?: boolean | null;
  locale_renderer_version?: string | null;
  localized_term_snapshot?: unknown;
  locale_presentation_overrides?: unknown;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeRow(row: CustomerDealLocalizationRpcRow, expectedLocale: SupportedLocale): CustomerDealLocalization | null {
  if (
    !row.deal_id ||
    row.locale !== expectedLocale ||
    !row.headline?.trim() ||
    !row.localization_hash?.trim() ||
    !["source_creative", "persuasive_transcreation", "deterministic_fallback"].includes(row.translation_status ?? "") ||
    !["not_required", "pass"].includes(row.qa_decision ?? "")
  ) {
    return null;
  }

  return {
    dealId: row.deal_id,
    offerVersionId: row.offer_version_id ?? null,
    locale: expectedLocale,
    sourceLocale: row.source_locale === "en-US" || row.source_locale === "es-US" || row.source_locale === "ko-KR"
      ? row.source_locale
      : null,
    headline: row.headline.trim(),
    supportingCopy: row.supporting_copy?.trim() || null,
    imageAltText: row.image_alt_text?.trim() || null,
    localizationHash: row.localization_hash.trim(),
    localizationBundleHash: row.localization_bundle_hash?.trim() || null,
    translationStatus: row.translation_status as CustomerDealLocalization["translationStatus"],
    qaDecision: row.qa_decision as CustomerDealLocalization["qaDecision"],
    qaReasonCodes: stringArray(row.qa_reason_codes),
    deterministicFallback: Boolean(row.deterministic_fallback),
    localeRendererVersion: row.locale_renderer_version?.trim() || null,
    localizedTermSnapshot: row.localized_term_snapshot,
    localePresentationOverrides: row.locale_presentation_overrides,
  };
}

export async function fetchCustomerDealLocalizations(
  dealIds: string[],
  locale: SupportedLocale,
): Promise<Map<string, CustomerDealLocalization>> {
  const uniqueIds = Array.from(new Set(dealIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())));
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await supabase.rpc("customer_deal_localizations", {
    p_deal_ids: uniqueIds,
    p_locale: locale,
  });
  if (error || !Array.isArray(data)) {
    if (error) logPostgrestError("customer deal localizations", error);
    return new Map();
  }

  const byDealId = new Map<string, CustomerDealLocalization>();
  for (const row of data as CustomerDealLocalizationRpcRow[]) {
    const normalized = normalizeRow(row, locale);
    if (normalized) byDealId.set(normalized.dealId, normalized);
  }
  return byDealId;
}
