import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import en from "./i18n/locales/en.json";
import es from "./i18n/locales/es.json";
import ko from "./i18n/locales/ko.json";
import { localizedBusinessCategoryLabel } from "./business-category-label";

const resources = { en, es, ko } as const;

function t(locale: keyof typeof resources, key: string): string {
  return key.split(".").reduce<unknown>((value, part) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[part];
  }, resources[locale]) as string;
}

function testT(locale: keyof typeof resources): TFunction {
  return ((key: string) => t(locale, key)) as TFunction;
}

describe("localizedBusinessCategoryLabel", () => {
  it("translates stored category ids through business setup labels", () => {
    expect(localizedBusinessCategoryLabel("restaurant", testT("ko"))).toBe("레스토랑");
    expect(localizedBusinessCategoryLabel("restaurant", testT("es"))).toBe("Restaurante");
  });

  it("keeps custom category text unchanged", () => {
    expect(localizedBusinessCategoryLabel("Neighborhood tea bar", testT("en"))).toBe("Neighborhood tea bar");
  });

  it("returns null for blank category values", () => {
    expect(localizedBusinessCategoryLabel("  ", testT("en"))).toBeNull();
    expect(localizedBusinessCategoryLabel(null, testT("en"))).toBeNull();
  });
});
