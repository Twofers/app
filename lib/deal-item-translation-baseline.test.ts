// T0 GUARD RAIL for the "Translate" plan (docs/plans/translate.md).
//
// This file FREEZES the deterministic customer-facing offer text produced TODAY,
// before any dictionary expansion (T2) or switch work. The customer render path
// calls renderLocalizedOfferFromDefinition with NO providedTerms and NO
// doNotTranslateTerms (see buildOfferDefinitionFromDealDisplay in
// lib/localized-deal-display.ts), so that is exactly what this matrix exercises.
//
// Why it exists: T2 expands the reviewed dictionary. Every change to what a
// customer reads must show up here as a reviewed diff — never a silent shift.
// When T2 intentionally changes a line, update the snapshot in the SAME commit
// and eyeball the diff. A snapshot change with no corresponding dictionary
// change in the same commit is a bug.
//
// The hard toBe() assertions below the snapshot pin the specific behaviors the
// plan is about (coverage gap, reverse direction, brand preservation) so they
// cannot be erased by a blind `vitest -u`.

import { describe, expect, it } from "vitest";

import { renderLocalizedOfferFromDefinition } from "./localized-offer-renderer";
import { buildOfferDefinitionV1 } from "./offer-definition";
import { SUPPORTED_LOCALES, type SupportedLocale } from "./supported-locales";

type ItemFixture = {
  label: string;
  dealType: "PERCENT_OFF_SINGLE_ITEM" | "BUY_ONE_GET_ONE_FREE" | "BUY_ONE_GET_SOMETHING_FREE";
  item?: string; // percent-off + same-item
  requiredItem?: string; // cross-item
  freeItem?: string; // cross-item
  discountPercent?: number;
  doNotTranslate?: string[];
};

// Chosen to exercise every category the plan names: dictionary hit, dictionary
// miss, size-modified, brand (with + without do-not-translate), and reverse
// direction (item authored in es / ko viewed by every locale).
const FIXTURES: ItemFixture[] = [
  { label: "en dict-hit percent-off (iced tea)", dealType: "PERCENT_OFF_SINGLE_ITEM", item: "iced tea", discountPercent: 40 },
  { label: "en dict-hit BOGO (cold brew)", dealType: "BUY_ONE_GET_ONE_FREE", requiredItem: "cold brew" },
  { label: "en size-modified BOGO (large latte)", dealType: "BUY_ONE_GET_ONE_FREE", requiredItem: "large latte" },
  { label: "en dict-MISS percent-off (strawberry matcha)", dealType: "PERCENT_OFF_SINGLE_ITEM", item: "strawberry matcha", discountPercent: 40 },
  { label: "en cross-item free (croissant -> coffee)", dealType: "BUY_ONE_GET_SOMETHING_FREE", requiredItem: "croissant", freeItem: "coffee" },
  { label: "en brand no-DNT (Cedar Bean Nitro)", dealType: "PERCENT_OFF_SINGLE_ITEM", item: "Cedar Bean Nitro", discountPercent: 40 },
  { label: "en brand WITH-DNT (Cedar Bean Nitro)", dealType: "PERCENT_OFF_SINGLE_ITEM", item: "Cedar Bean Nitro", discountPercent: 40, doNotTranslate: ["Cedar Bean Nitro"] },
  { label: "ko-authored BOGO (아메리카노)", dealType: "BUY_ONE_GET_ONE_FREE", requiredItem: "아메리카노" },
  { label: "es-authored percent-off (café de olla)", dealType: "PERCENT_OFF_SINGLE_ITEM", item: "café de olla", discountPercent: 40 },
];

function definitionFor(fixture: ItemFixture) {
  const definition = buildOfferDefinitionV1({
    businessId: "biz_baseline",
    businessName: "Cedar Bean",
    locationId: "loc_baseline",
    locationName: "Cedar Bean - Irving",
    dealEligibility:
      fixture.dealType === "PERCENT_OFF_SINGLE_ITEM"
        ? {
            dealType: "PERCENT_OFF_SINGLE_ITEM",
            appliesTo: "SINGLE_ITEM",
            discountPercent: fixture.discountPercent ?? 40,
            itemId: "sku_discount_item",
            itemDescription: fixture.item ?? "cold brew",
            itemRetailValueCents: 500,
          }
        : {
            dealType: fixture.dealType,
            appliesTo: "SINGLE_ITEM",
            requiredPurchaseQuantity: 1,
            requiredItemId: "sku_paid",
            requiredItemDescription: fixture.requiredItem ?? "latte",
            requiredItemRetailValueCents: 600,
            freeItemQuantity: 1,
            freeItemDescription: fixture.freeItem ?? fixture.requiredItem ?? "latte",
            freeItemRetailValueCents: 600,
            freeItemDiscountPercent: 100,
          },
    eligibilityResult: { eligible: true, eligibilityStatus: "VALID", customerValuePercent: 50 },
    activeWindowHumanReadable: "Today 2:00 PM to 4:00 PM",
    quantityLimit: 20,
    schedule: {
      mode: "one_time",
      summary: "Today 2:00 PM to 4:00 PM",
      startsAt: "2026-06-23T14:00:00-05:00",
      endsAt: "2026-06-23T16:00:00-05:00",
      timeZone: "America/Chicago",
    },
  });
  if (!definition) throw new Error(`baseline fixture built a null definition: ${fixture.label}`);
  return definition;
}

function renderAll(fixture: ItemFixture): Record<SupportedLocale, string> {
  const definition = definitionFor(fixture);
  const out = {} as Record<SupportedLocale, string>;
  for (const locale of SUPPORTED_LOCALES) {
    out[locale] = renderLocalizedOfferFromDefinition(definition, {
      locale,
      doNotTranslateTerms: fixture.doNotTranslate,
    }).primaryOfferLine;
  }
  return out;
}

describe("deal item-name translation — T0 frozen baseline", () => {
  it("freezes today's deterministic offer line for the full source×viewer matrix", () => {
    const matrix: Record<string, Record<SupportedLocale, string>> = {};
    for (const fixture of FIXTURES) matrix[fixture.label] = renderAll(fixture);
    expect(matrix).toMatchSnapshot();
  });

  // Explicit pins for the exact behaviors the plan changes, so they survive `-u`.

  it("dictionary-covered item names DO translate today (baseline, not a gap)", () => {
    const icedTea = renderAll(FIXTURES[0]);
    expect(icedTea["es-US"]).toContain("té helado");
    expect(icedTea["ko-KR"]).not.toContain("iced tea");
  });

  it("GAP: an out-of-dictionary item leaks English into the Spanish sentence", () => {
    const matcha = renderAll(FIXTURES[3]);
    expect(matcha["es-US"]).toContain("strawberry matcha"); // TODAY: untranslated
    // When T2 adds the entry, this assertion flips — update it deliberately then.
  });

  it("GAP: reverse direction — a Korean item name shows English viewers Hangul today", () => {
    const americano = renderAll(FIXTURES[7]);
    expect(americano["en-US"]).toContain("아메리카노"); // TODAY: not pivoted to "americano"
  });

  it("brand names: preserved with do-not-translate, dictionary-driven without it", () => {
    const withDnt = renderAll(FIXTURES[6]);
    expect(withDnt["es-US"]).toContain("Cedar Bean Nitro"); // merchant intent wins — must stay true forever
  });
});
