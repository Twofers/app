import { describe, expect, it } from "vitest";

import { appLocaleFromLanguage, isAppLocale } from "./config";

describe("app i18n config", () => {
  it("recognizes the supported app locale ids", () => {
    expect(isAppLocale("en")).toBe(true);
    expect(isAppLocale("es")).toBe(true);
    expect(isAppLocale("ko")).toBe(true);
    expect(isAppLocale("es-US")).toBe(false);
  });

  it("normalizes device and i18next language tags to app locales", () => {
    expect(appLocaleFromLanguage("en")).toBe("en");
    expect(appLocaleFromLanguage("en-US")).toBe("en");
    expect(appLocaleFromLanguage("es-US")).toBe("es");
    expect(appLocaleFromLanguage("ko-KR")).toBe("ko");
    expect(appLocaleFromLanguage("ko_KR")).toBe("ko");
    expect(appLocaleFromLanguage("fr-FR")).toBe("en");
    expect(appLocaleFromLanguage(null)).toBe("en");
  });
});
