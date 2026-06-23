export const SUPPORTED_LOCALES = ["en-US", "es-US", "ko-KR"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type SupportedAppLanguage = "en" | "es" | "ko";

export type SupportedLocaleMetadata = {
  locale: SupportedLocale;
  appLanguage: SupportedAppLanguage;
  englishName: string;
  nativeName: string;
  productLabel: string;
};

export const SUPPORTED_LOCALE_METADATA: Record<SupportedLocale, SupportedLocaleMetadata> = {
  "en-US": {
    locale: "en-US",
    appLanguage: "en",
    englishName: "English",
    nativeName: "English",
    productLabel: "English",
  },
  "es-US": {
    locale: "es-US",
    appLanguage: "es",
    englishName: "U.S. Spanish",
    nativeName: "Español",
    productLabel: "Español",
  },
  "ko-KR": {
    locale: "ko-KR",
    appLanguage: "ko",
    englishName: "Korean",
    nativeName: "한국어",
    productLabel: "한국어",
  },
};

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

export const DEFAULT_SUPPORTED_LOCALE: SupportedLocale = "en-US";

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return typeof value === "string" && SUPPORTED_LOCALE_SET.has(value);
}

export function normalizeSupportedLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  const clean = value.trim().replace("_", "-");
  if (isSupportedLocale(clean)) return clean;
  const lower = clean.toLowerCase();
  if (lower === "en" || lower.startsWith("en-")) return "en-US";
  if (lower === "es" || lower.startsWith("es-")) return "es-US";
  if (lower === "ko" || lower.startsWith("ko-")) return "ko-KR";
  return null;
}

export function supportedLocaleOrDefault(value: string | null | undefined): SupportedLocale {
  return normalizeSupportedLocale(value) ?? DEFAULT_SUPPORTED_LOCALE;
}

export function supportedLocaleToAppLanguage(locale: SupportedLocale): SupportedAppLanguage {
  return SUPPORTED_LOCALE_METADATA[locale].appLanguage;
}

export function enabledSupportedLocales(value: readonly string[] | null | undefined): SupportedLocale[] {
  const source = value && value.length > 0 ? value : SUPPORTED_LOCALES;
  const out: SupportedLocale[] = [];
  for (const raw of source) {
    const locale = normalizeSupportedLocale(raw);
    if (locale && !out.includes(locale)) out.push(locale);
  }
  return out.length > 0 ? out : [...SUPPORTED_LOCALES];
}
