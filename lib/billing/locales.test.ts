import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/locales/en.json";
import es from "@/lib/i18n/locales/es.json";
import ko from "@/lib/i18n/locales/ko.json";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(child, next);
  });
}

describe("billing locale parity", () => {
  it("keeps billing keys aligned in English, Spanish, and Korean", () => {
    const enKeys = flattenKeys(en.billing).sort();
    expect(flattenKeys(es.billing).sort()).toEqual(enKeys);
    expect(flattenKeys(ko.billing).sort()).toEqual(enKeys);
  });

  it("keeps billing manage keys aligned in English, Spanish, and Korean", () => {
    const enKeys = flattenKeys(en.billingManage).sort();
    expect(flattenKeys(es.billingManage).sort()).toEqual(enKeys);
    expect(flattenKeys(ko.billingManage).sort()).toEqual(enKeys);
  });

  it("uses Twofer Business instead of the old customer-facing tier names", () => {
    for (const locale of [en, es, ko]) {
      expect(JSON.stringify(locale.billing)).not.toMatch(/Twofer Pro|Twofer Premium/);
      expect(JSON.stringify(locale.billing)).toContain("Twofer Business");
    }
  });
});
