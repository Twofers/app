import { describe, expect, it } from "vitest";

import type { LocalizedOfferTerm } from "./localized-offer-terms";
import {
  KOREAN_COUNTER_FREE_FALLBACK_TEMPLATE_ID,
  resolveKoreanOfferTemplate,
} from "./korean-offer-template-resolver";
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
    expect(bundle["ko-KR"].primaryOfferLine).toBe("\uAD6C\uB9E4 \uD56D\uBAA9: \uB77C\uB5BC \u00D7 1\n\uCD94\uAC00 \uD61C\uD0DD: \uB77C\uB5BC \u00D7 1");
    expect(bundle["ko-KR"].compactOfferLine).toBe("\uAD6C\uB9E4 \uD56D\uBAA9: \uB77C\uB5BC \u00D7 1 \u00B7 \uCD94\uAC00 \uD61C\uD0DD: \uB77C\uB5BC \u00D7 1");
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
    expect(korean.primaryOfferLine).toBe("\uAD6C\uB9E4 \uD56D\uBAA9: \uB77C\uC9C0 \uCEE4\uD53C \u00D7 1\n\uCD94\uAC00 \uD61C\uD0DD: \uB77C\uC9C0 \uCEE4\uD53C \u00D7 1");
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
    expect(korean.primaryOfferLine).toBe("\uAD6C\uB9E4 \uD56D\uBAA9: \uC544\uC774\uC2A4 \uB77C\uB5BC \u00D7 1\n\uCD94\uAC00 \uD61C\uD0DD: \uCFE0\uD0A4 \u00D7 1");
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

  it("uses counter-free Korean fallback until counters are reviewer-approved", () => {
    const paidTerm = term({
      entityId: "sku_paid",
      locale: "ko-KR",
      displayName: "커피",
      koreanCounterId: "cup",
    });
    const resolution = resolveKoreanOfferTemplate({ paidTerm, rewardTerm: paidTerm });

    expect(resolution.templateId).toBe(KOREAN_COUNTER_FREE_FALLBACK_TEMPLATE_ID);
    expect(resolution.counterFallbackUsed).toBe(true);
    expect(resolution.reasonCodes).toContain("KOREAN_COUNTER_NOT_REVIEWED");
  });
});
