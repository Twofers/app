import {
  DEFAULT_SUPPORTED_LOCALE,
  enabledSupportedLocales,
  normalizeSupportedLocale,
  type SupportedLocale,
} from "./supported-locales";

export type AdLocaleResolutionSource =
  | "customer_preference"
  | "app_language"
  | "device_language"
  | "english_fallback"
  | "source_locale_fallback";

export type ResolvedAdLocale = {
  locale: SupportedLocale;
  source: AdLocaleResolutionSource;
  enabledLocales: SupportedLocale[];
};

export type ResolveAdLocaleParams = {
  customerPreferredLocale?: string | null;
  appLanguage?: string | null;
  deviceLanguage?: string | null;
  adSourceLocale?: string | null;
  enabledLocales?: readonly string[] | null;
};

function enabledHas(enabled: readonly SupportedLocale[], locale: SupportedLocale | null): locale is SupportedLocale {
  return Boolean(locale && enabled.includes(locale));
}

export function resolveAdLocale(params: ResolveAdLocaleParams): ResolvedAdLocale {
  const enabled = enabledSupportedLocales(params.enabledLocales);
  const candidates: Array<[AdLocaleResolutionSource, string | null | undefined]> = [
    ["customer_preference", params.customerPreferredLocale],
    ["app_language", params.appLanguage],
    ["device_language", params.deviceLanguage],
  ];

  for (const [source, raw] of candidates) {
    const locale = normalizeSupportedLocale(raw);
    if (enabledHas(enabled, locale)) return { locale, source, enabledLocales: enabled };
  }

  if (enabled.includes(DEFAULT_SUPPORTED_LOCALE)) {
    return {
      locale: DEFAULT_SUPPORTED_LOCALE,
      source: "english_fallback",
      enabledLocales: enabled,
    };
  }

  const sourceLocale = normalizeSupportedLocale(params.adSourceLocale);
  if (enabledHas(enabled, sourceLocale)) {
    return {
      locale: sourceLocale,
      source: "source_locale_fallback",
      enabledLocales: enabled,
    };
  }

  return {
    locale: enabled[0] ?? DEFAULT_SUPPORTED_LOCALE,
    source: "source_locale_fallback",
    enabledLocales: enabled,
  };
}
