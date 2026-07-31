// T2 verification for the "Translate" plan (docs/plans/translate.md).
// Proves the expanded item-name dictionary closes the coverage + reverse-
// direction gaps when the switch is on, stays byte-identical when off, never
// overrides a reviewed base term, and only ever uses natively-reviewed Korean
// counters.

import { afterEach, describe, expect, it } from "vitest";

import { renderLocalizedOfferFromDefinition } from "./localized-offer-renderer";
import { buildOfferDefinitionV1 } from "./offer-definition";
import { buildLocalizedDealDisplay, type LocalizedDealDisplayFields } from "./localized-deal-display";
import { DEAL_ITEM_TRANSLATION_EXPANSION } from "./localized-offer-terms-expansion";
import { getReviewedKoreanCounter } from "./korean-counter-registry";
import type { SupportedLocale } from "./supported-locales";

const SWITCH = "DEAL_ITEM_TRANSLATION_LOCALES";
afterEach(() => {
  delete process.env[SWITCH];
});

function percentOff(item: string) {
  const definition = buildOfferDefinitionV1({
    businessId: "biz",
    businessName: "Cedar Bean",
    locationId: "loc",
    locationName: "Cedar Bean - Irving",
    dealEligibility: {
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemId: "sku",
      itemDescription: item,
      itemRetailValueCents: 500,
    },
    eligibilityResult: { eligible: true, eligibilityStatus: "VALID", customerValuePercent: 50 },
    activeWindowHumanReadable: "Today 2:00 PM to 4:00 PM",
    quantityLimit: 20,
    schedule: { mode: "one_time", summary: null, startsAt: null, endsAt: null, timeZone: "America/Chicago" },
  });
  if (!definition) throw new Error("null definition");
  return definition;
}

function line(item: string, locale: SupportedLocale, withExpansion: boolean): string {
  return renderLocalizedOfferFromDefinition(percentOff(item), {
    locale,
    extraDictionary: withExpansion ? DEAL_ITEM_TRANSLATION_EXPANSION : undefined,
  }).primaryOfferLine;
}

describe("item-name expansion — renderer level", () => {
  it("closes the Spanish coverage gap for an out-of-base item", () => {
    expect(line("strawberry matcha", "es-US", false)).toContain("strawberry matcha"); // base: leaks
    expect(line("strawberry matcha", "es-US", true)).toContain("matcha de fresa"); // expansion: fixed
  });

  it("closes the Korean field-dump for the same item (real sentence with a counter)", () => {
    expect(line("strawberry matcha", "ko-KR", false)).toContain("할인 항목:"); // base: field dump
    const withExpansion = line("strawberry matcha", "ko-KR", true);
    expect(withExpansion).toContain("딸기 말차"); // 말차 = matcha (NOT 마차 = carriage)
    expect(withExpansion).not.toContain("할인 항목:"); // now a sentence
    expect(withExpansion).toContain("잔"); // cup counter
  });

  it("fixes the reverse direction: a Korean item reads in English / Spanish", () => {
    expect(line("아메리카노", "en-US", false)).toContain("아메리카노"); // base: Hangul leaks to EN
    expect(line("아메리카노", "en-US", true)).toContain("americano");
    expect(line("아메리카노", "es-US", true)).toContain("americano");
  });

  it("never overrides a reviewed base term, even with the expansion supplied", () => {
    // "coffee" is in the base (café / 커피). Expansion must not change it.
    expect(line("coffee", "es-US", true)).toBe(line("coffee", "es-US", false));
    expect(line("coffee", "ko-KR", true)).toBe(line("coffee", "ko-KR", false));
    // "cold brew" stays the base's deliberate Spanish loanword.
    expect(line("cold brew", "es-US", true)).toContain("cold brew");
  });
});

describe("item-name expansion — customer switch gating", () => {
  const deal: LocalizedDealDisplayFields = {
    id: "deal-1",
    business_id: "biz",
    deal_type: "PERCENT_OFF_SINGLE_ITEM",
    applies_to: "SINGLE_ITEM",
    discount_percent: 40,
    item_description: "strawberry matcha",
    max_claims: 20,
    businesses: { name: "Cedar Bean", location: "Irving" },
  } as unknown as LocalizedDealDisplayFields;

  function display(locale: SupportedLocale) {
    return buildLocalizedDealDisplay({
      deal,
      locale,
      localeResolutionSource: "app_language",
      useLocalizedOfferRenderer: true,
      fallbackLanguage: "es",
    });
  }

  it("switch OFF (default): Spanish viewer still sees the untranslated item", () => {
    const { title, description } = display("es-US");
    expect(`${title} ${description}`).toContain("strawberry matcha");
  });

  it("switch ON for es-US: Spanish viewer sees the translated item", () => {
    process.env[SWITCH] = "en-US,es-US,ko-KR";
    const { title, description } = display("es-US");
    expect(`${title} ${description}`).toContain("matcha de fresa");
  });

  it("switch scoped per locale: es-US only leaves Korean unchanged", () => {
    process.env[SWITCH] = "es-US";
    const ko = display("ko-KR");
    expect(`${ko.title} ${ko.description}`).toContain("할인 항목:"); // ko not enabled → base field-dump
  });
});

describe("item-name expansion — safety invariants", () => {
  it("uses ONLY natively-reviewed Korean counters (cup / piece / serving)", () => {
    const offenders: string[] = [];
    for (const [key, entry] of Object.entries(DEAL_ITEM_TRANSLATION_EXPANSION)) {
      const counterId = entry["ko-KR"]?.koreanCounterId;
      if (counterId && !getReviewedKoreanCounter(counterId)) offenders.push(`${key}:${counterId}`);
    }
    expect(offenders).toEqual([]);
  });

  it("every entry provides at least one locale display name", () => {
    for (const [key, entry] of Object.entries(DEAL_ITEM_TRANSLATION_EXPANSION)) {
      const names = Object.values(entry).map((value) => value?.displayName).filter(Boolean);
      expect(names.length, `entry "${key}" has no display names`).toBeGreaterThan(0);
    }
  });
});
