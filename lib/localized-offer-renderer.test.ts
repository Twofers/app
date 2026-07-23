import { describe, expect, it } from "vitest";

import type { LocalizedOfferTerm } from "./localized-offer-terms";
import { resolveKoreanOfferTemplate } from "./korean-offer-template-resolver";
import {
  renderLocalizedOfferBundleFromDefinition,
  renderLocalizedOfferFromDefinition,
} from "./localized-offer-renderer";
import { buildOfferDefinitionV1 } from "./offer-definition";

function definitionFor(input: {
  dealType: "BUY_ONE_GET_ONE_FREE" | "BUY_ONE_GET_SOMETHING_FREE" | "PERCENT_OFF_SINGLE_ITEM";
  requiredItemDescription?: string;
  freeItemDescription?: string;
  itemDescription?: string;
  discountPercent?: number;
}) {
  const definition = buildOfferDefinitionV1({
    businessId: "biz_123",
    businessName: "Cedar Bean",
    locationId: "loc_123",
    locationName: "Cedar Bean - Irving",
    dealEligibility: input.dealType === "PERCENT_OFF_SINGLE_ITEM"
      ? {
          dealType: input.dealType,
          appliesTo: "SINGLE_ITEM",
          discountPercent: input.discountPercent ?? 40,
          itemId: "sku_discount_item",
          itemDescription: input.itemDescription ?? "cold brew",
          itemRetailValueCents: 500,
        }
      : {
          dealType: input.dealType,
          appliesTo: "SINGLE_ITEM",
          requiredPurchaseQuantity: 1,
          requiredItemId: "sku_paid",
          requiredItemDescription: input.requiredItemDescription ?? "latte",
          requiredItemRetailValueCents: 600,
          freeItemQuantity: 1,
          freeItemDescription: input.freeItemDescription ?? input.requiredItemDescription ?? "latte",
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
  if (!definition) throw new Error("expected valid definition");
  return definition;
}

function term(term: Partial<LocalizedOfferTerm> & Pick<LocalizedOfferTerm, "entityId" | "locale" | "displayName">): LocalizedOfferTerm {
  return {
    doNotTranslate: false,
    approvedLocalizedName: true,
    source: "reviewed_dictionary",
    verificationStatus: "verified",
    version: "reviewed-term-v1",
    ...term,
  };
}

describe("localized offer renderer", () => {
  it("renders exact same-item offer mechanics in all supported locales without translating a finished sentence", () => {
    const bundle = renderLocalizedOfferBundleFromDefinition(definitionFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "latte",
      freeItemDescription: "latte",
    }));

    expect(bundle["en-US"].primaryOfferLine).toBe("Buy one latte and get one free");
    expect(bundle["es-US"].primaryOfferLine).toBe("Al comprar 1 latte, recibes 1 latte gratis");
    // S9: latte resolves the native-reviewed "cup" counter, so Korean now gets the sentence
    // shape instead of the counter-free field dump. Deliberately updated \u2014 the dump was the
    // placeholder for terms whose counter has NOT been reviewed, and it is still asserted
    // for those in "keeps the counter-free field dump when a counter is not native-reviewed".
    expect(bundle["ko-KR"].primaryOfferLine).toBe("\uB77C\uB5BC 1\uC794 \uAD6C\uB9E4 \uC2DC \uB77C\uB5BC 1\uC794 \uBB34\uB8CC");
    expect(bundle["ko-KR"].compactOfferLine).toBe("\uB77C\uB5BC 1\uC794 \uAD6C\uB9E4 \uC2DC \uB77C\uB5BC 1\uC794 \uBB34\uB8CC");
    expect(bundle["es-US"].termsLine).toContain("Cedar Bean - Irving");
    expect(bundle["ko-KR"].termsLine).toContain("Cedar Bean - Irving");
  });

  it("uses approved localized term snapshots while preserving the same offer facts", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "bagel",
      freeItemDescription: "coffee",
    });
    const providedTerms: LocalizedOfferTerm[] = [
      term({ entityId: "sku_paid", locale: "es-US", displayName: "bagel" }),
      term({ entityId: "reward:coffee", locale: "es-US", displayName: "café" }),
      term({ entityId: "sku_paid", locale: "ko-KR", displayName: "베이글" }),
      term({ entityId: "reward:coffee", locale: "ko-KR", displayName: "커피" }),
    ];

    const spanish = renderLocalizedOfferFromDefinition(definition, { locale: "es-US", providedTerms });
    const korean = renderLocalizedOfferFromDefinition(definition, { locale: "ko-KR", providedTerms });

    expect(spanish.primaryOfferLine).toBe("Al comprar 1 bagel, recibes 1 café gratis");
    expect(spanish.localizedTermSnapshotIds).toEqual([
      "sku_paid:es-US:reviewed-term-v1",
      "reward:coffee:es-US:reviewed-term-v1",
    ]);
    expect(korean.primaryOfferLine).toBe("구매 항목: 베이글 × 1\n추가 혜택: 커피 × 1");
    expect(korean.localizedTermSnapshotIds).toEqual([
      "sku_paid:ko-KR:reviewed-term-v1",
      "reward:coffee:ko-KR:reviewed-term-v1",
    ]);
  });
  // S9. Korean has two shapes on purpose: a counter-free field dump for terms whose counter
  // has not been native-reviewed, and a real sentence for terms whose counter HAS been.
  // Only the dump was ever implemented — `resolveKoreanOfferTemplate` returned
  // usesCounters:true and both branches emitted the same record anyway — so a Korean shopper
  // read "구매 항목: X × 1 / 추가 혜택: Y × 1" where a Spanish one read a sentence.
  it("renders a Korean sentence when both counters are native-reviewed", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "large coffee drink",
      freeItemDescription: "cookie",
    });
    const providedTerms: LocalizedOfferTerm[] = [
      term({ entityId: "sku_paid", locale: "ko-KR", displayName: "라지 커피 음료", koreanCounterId: "cup" }),
      term({ entityId: "reward:cookie", locale: "ko-KR", displayName: "쿠키", koreanCounterId: "piece" }),
    ];

    const korean = renderLocalizedOfferFromDefinition(definition, { locale: "ko-KR", providedTerms });

    expect(korean.primaryOfferLine).toBe("라지 커피 음료 1잔 구매 시 쿠키 1개 무료");
    // The whole point: it must read as an offer, not as a record.
    expect(korean.primaryOfferLine).not.toContain("구매 항목:");
    expect(korean.primaryOfferLine).not.toContain("×");
    expect(korean.primaryOfferLine).not.toContain("\n");
  });

  it("keeps the counter-free field dump when a counter is not native-reviewed", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "bagel",
      freeItemDescription: "coffee",
    });
    const providedTerms: LocalizedOfferTerm[] = [
      term({ entityId: "sku_paid", locale: "ko-KR", displayName: "베이글", koreanCounterId: "unknown-counter" }),
      term({ entityId: "reward:coffee", locale: "ko-KR", displayName: "커피", koreanCounterId: "cup" }),
    ];

    // Guessing a counter word without native review is the thing this fallback exists to
    // avoid; the fix must not erode it.
    expect(renderLocalizedOfferFromDefinition(definition, { locale: "ko-KR", providedTerms }).primaryOfferLine).toBe(
      "구매 항목: 베이글 × 1\n추가 혜택: 커피 × 1",
    );
  });

  it("renders a Korean percent-off sentence when the counter is native-reviewed", () => {
    const definition = definitionFor({ dealType: "PERCENT_OFF_SINGLE_ITEM", itemDescription: "cold brew", discountPercent: 40 });
    const providedTerms: LocalizedOfferTerm[] = [
      term({ entityId: "sku_discount_item", locale: "ko-KR", displayName: "콜드브루", koreanCounterId: "cup" }),
    ];

    expect(renderLocalizedOfferFromDefinition(definition, { locale: "ko-KR", providedTerms }).primaryOfferLine).toBe(
      "콜드브루 1잔 40% 할인",
    );
  });

  it("renders English any-qualified offer facts without awkward articles", () => {
    const coffeeCookie = renderLocalizedOfferFromDefinition(definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "any large coffee drink",
      freeItemDescription: "cookie of your choice",
    }), { locale: "en-US" });
    const discount = renderLocalizedOfferFromDefinition(definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      itemDescription: "any croissant",
      discountPercent: 40,
    }), { locale: "en-US" });

    expect(coffeeCookie.primaryOfferLine).toBe("Buy any large coffee drink and get a free cookie of your choice");
    expect(discount.primaryOfferLine).toBe("Get 40% off any croissant");
  });

  it("localizes generic menu item terms in deterministic non-English offer lines", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "Large coffee",
      freeItemDescription: "Large coffee",
    });

    const spanish = renderLocalizedOfferFromDefinition(definition, { locale: "es-US" });
    const korean = renderLocalizedOfferFromDefinition(definition, { locale: "ko-KR" });

    expect(spanish.primaryOfferLine).toBe("Al comprar 1 caf\u00E9 grande, recibes 1 caf\u00E9 grande gratis");
    // S9: reviewed "cup" counter -> sentence shape. See the bundle test above.
    expect(korean.primaryOfferLine).toBe("\uB77C\uC9C0 \uCEE4\uD53C 1\uC794 \uAD6C\uB9E4 \uC2DC \uB77C\uC9C0 \uCEE4\uD53C 1\uC794 \uBB34\uB8CC");
    expect(korean.primaryOfferLine).not.toContain("Large coffee");
  });

  it("localizes common composed cafe drink terms in exact offer mechanics", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      requiredItemDescription: "iced latte",
      freeItemDescription: "cookie",
    });

    const spanish = renderLocalizedOfferFromDefinition(definition, { locale: "es-US" });
    const korean = renderLocalizedOfferFromDefinition(definition, { locale: "ko-KR" });

    expect(spanish.primaryOfferLine).toBe("Al comprar 1 latte helado, recibes 1 galleta gratis");
    // S9: the two counters correctly differ \u2014 \uC794 for the drink, \uAC1C for the cookie.
    expect(korean.primaryOfferLine).toBe("\uC544\uC774\uC2A4 \uB77C\uB5BC 1\uC794 \uAD6C\uB9E4 \uC2DC \uCFE0\uD0A4 1\uAC1C \uBB34\uB8CC");
    expect(korean.primaryOfferLine).not.toContain("iced latte");
  });

  it("keeps branded terms unchanged unless a localized name is provided", () => {
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      itemDescription: "Cedar Bean Nitro",
      discountPercent: 40,
    });

    const spanish = renderLocalizedOfferFromDefinition(definition, {
      locale: "es-US",
      doNotTranslateTerms: ["Cedar Bean Nitro"],
    });

    expect(spanish.primaryOfferLine).toBe("Recibe 40% de descuento en 1 Cedar Bean Nitro");
    expect(spanish.localizedTermSnapshotIds).toEqual([
      "sku_discount_item:es-US:preserved-merchant-term-v1",
    ]);
  });

  it("uses reviewed Korean counters after native reviewer approval", () => {
    const paidTerm = term({
      entityId: "sku_paid",
      locale: "ko-KR",
      displayName: "coffee",
      koreanCounterId: "cup",
    });
    const resolution = resolveKoreanOfferTemplate({ paidTerm, rewardTerm: paidTerm });

    expect(resolution.templateId).toBe("ko-KR.offer.reviewed-counter");
    expect(resolution.counterFallbackUsed).toBe(false);
    expect(resolution.usesCounters).toBe(true);
    expect(resolution.reasonCodes).toEqual([]);
  });

  it("uses counter-free Korean fallback for unknown counters", () => {
    const paidTerm = term({
      entityId: "sku_paid",
      locale: "ko-KR",
      displayName: "coffee",
      koreanCounterId: "unknown-counter",
    });
    const resolution = resolveKoreanOfferTemplate({ paidTerm, rewardTerm: paidTerm });

    expect(resolution.templateId).toBe("ko-KR.offer.counter-free-fallback");
    expect(resolution.counterFallbackUsed).toBe(true);
    expect(resolution.usesCounters).toBe(false);
    expect(resolution.reasonCodes).toContain("KOREAN_COUNTER_NOT_REVIEWED");
  });
});