import { type SupportedLocale } from "./supported-locales";

export type LocalizedOfferTermSource =
  | "merchant"
  | "merchant_profile"
  | "reviewed_dictionary"
  | "ai_suggested"
  | "system";

export type LocalizedOfferTermVerificationStatus =
  | "verified"
  | "needs_native_review"
  | "blocked";

export type LocalizedOfferTerm = {
  entityId: string;
  locale: SupportedLocale;
  displayName: string;
  shortDisplayName?: string;
  unitLabelSingular?: string;
  unitLabelPlural?: string;
  koreanCounterId?: string;
  doNotTranslate: boolean;
  approvedLocalizedName: boolean;
  source: LocalizedOfferTermSource;
  verificationStatus: LocalizedOfferTermVerificationStatus;
  version: string;
};

export type ResolveLocalizedOfferTermParams = {
  entityId?: string | null;
  sourceDisplayName: string;
  locale: SupportedLocale;
  providedTerms?: readonly LocalizedOfferTerm[] | null;
  doNotTranslateTerms?: readonly string[] | null;
};

export const PRESERVED_MERCHANT_TERM_VERSION = "preserved-merchant-term-v1";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeKey(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9가-힣\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string): string {
  const key = normalizeKey(value);
  return key.replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "") || "term";
}

function defaultEntityId(sourceDisplayName: string): string {
  return `merchant-term:${slug(sourceDisplayName)}`;
}

function matchesDoNotTranslate(value: string, terms: readonly string[] | null | undefined): boolean {
  const key = normalizeKey(value);
  return Boolean(key && (terms ?? []).some((term) => normalizeKey(term) === key));
}

function usableProvidedTerm(
  providedTerms: readonly LocalizedOfferTerm[] | null | undefined,
  entityId: string,
  locale: SupportedLocale,
): LocalizedOfferTerm | null {
  return (
    providedTerms?.find(
      (term) =>
        term.entityId === entityId &&
        term.locale === locale &&
        term.verificationStatus !== "blocked" &&
        cleanText(term.displayName).length > 0,
    ) ?? null
  );
}

export function resolveLocalizedOfferTerm(params: ResolveLocalizedOfferTermParams): LocalizedOfferTerm {
  const displayName = cleanText(params.sourceDisplayName) || "item";
  const entityId = cleanText(params.entityId) || defaultEntityId(displayName);
  const provided = usableProvidedTerm(params.providedTerms, entityId, params.locale);
  if (provided) return provided;

  const preserve = matchesDoNotTranslate(displayName, params.doNotTranslateTerms);
  return {
    entityId,
    locale: params.locale,
    displayName,
    doNotTranslate: true,
    approvedLocalizedName: false,
    source: preserve ? "merchant_profile" : "merchant",
    verificationStatus: preserve ? "verified" : "needs_native_review",
    version: PRESERVED_MERCHANT_TERM_VERSION,
  };
}

export function localizedTermSnapshotId(term: LocalizedOfferTerm): string {
  return `${term.entityId}:${term.locale}:${term.version}`;
}

export function hasVerifiedLocalizedName(term: LocalizedOfferTerm): boolean {
  return term.verificationStatus === "verified" && term.approvedLocalizedName && !term.doNotTranslate;
}
