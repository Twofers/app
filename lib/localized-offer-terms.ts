import { type SupportedLocale } from "./supported-locales.ts";

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
export const GENERIC_LOCALIZED_TERM_DICTIONARY_VERSION = "generic-localized-term-dictionary-v1";

type GenericLocalizedTermDictionaryEntry = Partial<Record<SupportedLocale, {
  displayName: string;
  koreanCounterId?: string;
}>>;

const GENERIC_LOCALIZED_TERM_DICTIONARY: Record<string, GenericLocalizedTermDictionaryEntry> = {
  bagel: {
    "es-US": { displayName: "bagel" },
    "ko-KR": { displayName: "\uBCA0\uC774\uAE00", koreanCounterId: "piece" },
  },
  "bacon and egg sandwich": {
    "es-US": { displayName: "s\u00E1ndwich de tocino y huevo" },
    "ko-KR": { displayName: "\uBCA0\uC774\uCEE8 \uC5D0\uADF8 \uC0CC\uB4DC\uC704\uCE58" },
  },
  "blueberry scone": {
    "es-US": { displayName: "scone de ar\u00E1ndanos" },
    "ko-KR": { displayName: "\uBE14\uB8E8\uBCA0\uB9AC \uC2A4\uCF58", koreanCounterId: "piece" },
  },
  coffee: {
    "es-US": { displayName: "caf\u00E9" },
    "ko-KR": { displayName: "\uCEE4\uD53C", koreanCounterId: "cup" },
  },
  "coffee drink": {
    "es-US": { displayName: "bebida de caf\u00E9" },
    "ko-KR": { displayName: "\uCEE4\uD53C \uC74C\uB8CC", koreanCounterId: "cup" },
  },
  "cold brew": {
    "es-US": { displayName: "cold brew" },
    "ko-KR": { displayName: "\uCF5C\uB4DC\uBE0C\uB8E8", koreanCounterId: "cup" },
  },
  cookie: {
    "es-US": { displayName: "galleta" },
    "ko-KR": { displayName: "\uCFE0\uD0A4", koreanCounterId: "piece" },
  },
  "cookie of your choice": {
    "es-US": { displayName: "galleta de tu elecci\u00F3n" },
    "ko-KR": { displayName: "\uC6D0\uD558\uB294 \uCFE0\uD0A4", koreanCounterId: "piece" },
  },
  croissant: {
    "es-US": { displayName: "croissant" },
    "ko-KR": { displayName: "\uD06C\uB8E8\uC544\uC0C1", koreanCounterId: "piece" },
  },
  "drip coffee": {
    "es-US": { displayName: "caf\u00E9 de filtro" },
    "ko-KR": { displayName: "\uB4DC\uB9BD \uCEE4\uD53C", koreanCounterId: "cup" },
  },
  espresso: {
    "es-US": { displayName: "espresso" },
    "ko-KR": { displayName: "\uC5D0\uC2A4\uD504\uB808\uC18C", koreanCounterId: "cup" },
  },
  "egg sandwich": {
    "es-US": { displayName: "s\u00E1ndwich de huevo" },
    "ko-KR": { displayName: "\uC5D0\uADF8 \uC0CC\uB4DC\uC704\uCE58" },
  },
  "house drip coffee": {
    "es-US": { displayName: "caf\u00E9 de filtro de la casa" },
    "ko-KR": { displayName: "\uD558\uC6B0\uC2A4 \uB4DC\uB9BD \uCEE4\uD53C", koreanCounterId: "cup" },
  },
  latte: {
    "es-US": { displayName: "latte" },
    "ko-KR": { displayName: "\uB77C\uB5BC", koreanCounterId: "cup" },
  },
  "large coffee": {
    "es-US": { displayName: "caf\u00E9 grande" },
    "ko-KR": { displayName: "\uB77C\uC9C0 \uCEE4\uD53C", koreanCounterId: "cup" },
  },
  "large coffee drink": {
    "es-US": { displayName: "bebida de caf\u00E9 grande" },
    "ko-KR": { displayName: "\uB77C\uC9C0 \uCEE4\uD53C \uC74C\uB8CC", koreanCounterId: "cup" },
  },
  "any large coffee drink": {
    "es-US": { displayName: "cualquier bebida de caf\u00E9 grande" },
    "ko-KR": { displayName: "\uBAA8\uB4E0 \uB77C\uC9C0 \uCEE4\uD53C \uC74C\uB8CC", koreanCounterId: "cup" },
  },
  "mango lassi": {
    "es-US": { displayName: "lassi de mango" },
    "ko-KR": { displayName: "\uB9DD\uACE0 \uB77C\uC2DC", koreanCounterId: "cup" },
  },
  "mini-cookie": {
    "es-US": { displayName: "mini galleta" },
    "ko-KR": { displayName: "\uBBF8\uB2C8 \uCFE0\uD0A4", koreanCounterId: "piece" },
  },
  muffin: {
    "es-US": { displayName: "muffin" },
    "ko-KR": { displayName: "\uBA38\uD540", koreanCounterId: "piece" },
  },
  pastry: {
    "es-US": { displayName: "pastelito" },
    "ko-KR": { displayName: "\uD398\uC774\uC2A4\uD2B8\uB9AC", koreanCounterId: "piece" },
  },
  scone: {
    "es-US": { displayName: "scone" },
    "ko-KR": { displayName: "\uC2A4\uCF58", koreanCounterId: "piece" },
  },
  tea: {
    "es-US": { displayName: "t\u00E9" },
    "ko-KR": { displayName: "\uCC28", koreanCounterId: "cup" },
  },
};

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

function dictionaryTerm(
  sourceDisplayName: string,
  locale: SupportedLocale,
  entityId: string,
): LocalizedOfferTerm | null {
  if (locale === "en-US") return null;
  const entry = GENERIC_LOCALIZED_TERM_DICTIONARY[normalizeKey(sourceDisplayName)]?.[locale];
  if (!entry?.displayName) return null;
  return {
    entityId,
    locale,
    displayName: entry.displayName,
    ...(entry.koreanCounterId ? { koreanCounterId: entry.koreanCounterId } : {}),
    doNotTranslate: false,
    approvedLocalizedName: true,
    source: "reviewed_dictionary",
    verificationStatus: "verified",
    version: GENERIC_LOCALIZED_TERM_DICTIONARY_VERSION,
  };
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
  const genericTerm = preserve ? null : dictionaryTerm(displayName, params.locale, entityId);
  if (genericTerm) return genericTerm;

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
