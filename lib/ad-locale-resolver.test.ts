import { describe, expect, it } from "vitest";

import { resolveAdLocale } from "./ad-locale-resolver";
import {
  enabledSupportedLocales,
  normalizeSupportedLocale,
  supportedLocaleToAppLanguage,
} from "./supported-locales";

describe("supported locales", () => {
  it("normalizes short app languages and device tags to product locales", () => {
    expect(normalizeSupportedLocale("en")).toBe("en-US");
    expect(normalizeSupportedLocale("es-MX")).toBe("es-US");
    expect(normalizeSupportedLocale("ko_KR")).toBe("ko-KR");
    expect(supportedLocaleToAppLanguage("es-US")).toBe("es");
    expect(enabledSupportedLocales(["es", "es-US", "ko-KR"])).toEqual(["es-US", "ko-KR"]);
  });
});

describe("resolveAdLocale", () => {
  it("uses explicit customer preference before app and device language", () => {
    expect(resolveAdLocale({
      customerPreferredLocale: "ko-KR",
      appLanguage: "es",
      deviceLanguage: "en-US",
      adSourceLocale: "en-US",
    })).toMatchObject({
      locale: "ko-KR",
      source: "customer_preference",
    });
  });

  it("falls through app, device, English, then source locale", () => {
    expect(resolveAdLocale({
      customerPreferredLocale: "fr-FR",
      appLanguage: "es-MX",
      deviceLanguage: "ko-KR",
      adSourceLocale: "en-US",
    })).toMatchObject({
      locale: "es-US",
      source: "app_language",
    });

    expect(resolveAdLocale({
      customerPreferredLocale: null,
      appLanguage: "fr-FR",
      deviceLanguage: "ko-KR",
      adSourceLocale: "es-US",
    })).toMatchObject({
      locale: "ko-KR",
      source: "device_language",
    });

    expect(resolveAdLocale({
      customerPreferredLocale: null,
      appLanguage: "fr-FR",
      deviceLanguage: "de-DE",
      adSourceLocale: "ko-KR",
    })).toMatchObject({
      locale: "en-US",
      source: "english_fallback",
    });
  });

  it("uses source locale when English is not enabled for an internal test bundle", () => {
    expect(resolveAdLocale({
      appLanguage: "fr-FR",
      deviceLanguage: "de-DE",
      adSourceLocale: "ko-KR",
      enabledLocales: ["ko-KR"],
    })).toMatchObject({
      locale: "ko-KR",
      source: "source_locale_fallback",
    });
  });
});
