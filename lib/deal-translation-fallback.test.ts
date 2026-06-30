import { describe, expect, it } from "vitest";
import { buildDealTranslationFallback } from "./deal-translation-fallback";
import { buildOfferDefinitionV1 } from "./offer-definition";

const offerDefinition = buildOfferDefinitionV1({
  businessId: "biz_123",
  businessName: "Cedar Bean",
  locationId: "loc_123",
  locationName: "Cedar Bean - Irving",
  dealEligibility: {
    dealType: "BUY_ONE_GET_SOMETHING_FREE",
    appliesTo: "SINGLE_ITEM",
    requiredPurchaseQuantity: 1,
    requiredItemDescription: "large coffee drink",
    freeItemQuantity: 1,
    freeItemDescription: "cookie",
    freeItemDiscountPercent: 100,
  },
  eligibilityResult: {
    eligible: true,
    eligibilityStatus: "VALID",
    customerValuePercent: 50,
  },
  quantityLimit: 50,
});

describe("deal translation fallback", () => {
  it("keeps English source copy publishable without fabricated translations", () => {
    expect(buildDealTranslationFallback({
      source_locale: "en",
      title: " Buy a large coffee and get a cookie free ",
      description: " Redeem today. ",
    })).toEqual({
      source_locale: "en",
      title_en: "Buy a large coffee and get a cookie free",
      title_es: "",
      title_ko: "",
      description_en: "Redeem today.",
      description_es: "",
      description_ko: "",
    });
  });

  it("keeps non-English source copy in the matching locale column only", () => {
    expect(buildDealTranslationFallback({
      source_locale: "es",
      title: "Cafe helado 2x1",
      description: "Compra uno y lleva otro gratis.",
    })).toMatchObject({
      source_locale: "es",
      title_en: "",
      title_es: "Cafe helado 2x1",
      title_ko: "",
      description_en: "",
      description_es: "Compra uno y lleva otro gratis.",
      description_ko: "",
    });
  });

  it("fills target language columns from locked offer facts when available", () => {
    expect(offerDefinition).not.toBeNull();
    const fallback = buildDealTranslationFallback({
      source_locale: "en",
      title: "Buy a large coffee drink and get a free cookie",
      description: "Redeem only at Cedar Bean - Irving. Limited to 50 available.",
      offerDefinition,
    });

    expect(fallback.title_en).toBe("Buy a large coffee drink and get a free cookie");
    expect(fallback.description_en).toBe("Redeem only at Cedar Bean - Irving. Limited to 50 available.");
    expect(fallback.title_es).toBe("Al comprar 1 bebida de caf\u00E9 grande, recibes 1 galleta gratis");
    expect(fallback.description_es).toContain("Canjea solo en Cedar Bean - Irving.");
    expect(fallback.description_es).toContain("Hay 50 reclamos disponibles.");
    expect(fallback.title_ko).toContain("\uB77C\uC9C0 \uCEE4\uD53C \uC74C\uB8CC");
    expect(fallback.title_ko).toContain("\uCFE0\uD0A4");
    expect(fallback.title_ko).not.toContain("large coffee drink");
    expect(fallback.title_ko).not.toContain("cookie");
    expect(fallback.description_ko).toContain("50");
  });
});
