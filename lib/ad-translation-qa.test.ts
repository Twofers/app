import { describe, expect, it } from "vitest";

import { validateAdTranscreationDeterministically } from "./ad-translation-qa";
import { buildOfferDefinitionV1 } from "./offer-definition";
import type { OfferDefinitionV1 } from "./offer-definition";

function definition(): OfferDefinitionV1 {
  const built = buildOfferDefinitionV1({
    businessId: "biz_123",
    businessName: "Cedar Bean",
    locationId: "loc_123",
    locationName: "Cedar Bean - Irving",
    dealEligibility: {
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "latte",
      requiredItemRetailValueCents: 600,
      freeItemQuantity: 1,
      freeItemDescription: "cookie",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    },
    eligibilityResult: {
      eligible: true,
      eligibilityStatus: "VALID",
      customerValuePercent: 50,
    },
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
  if (!built) throw new Error("expected offer definition");
  return built;
}

const sourceCreative = {
  headline: "Cedar Bean latte reward",
  supportingCopy: "Your afternoon latte comes with a cookie.",
  imageAltText: "Cedar Bean latte and cookie",
};

describe("ad translation deterministic QA", () => {
  it("passes natural U.S. Spanish that preserves protected terms", () => {
    const qa = validateAdTranscreationDeterministically({
      sourceLocale: "en-US",
      targetLocale: "es-US",
      sourceCreative,
      targetCreative: {
        headline: "Cedar Bean: latte con cookie gratis",
        supportingCopy: "Tu latte de la tarde viene con una cookie.",
        imageAltText: "Latte y cookie en Cedar Bean",
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(qa).toMatchObject({
      locale: "es-US",
      decision: "pass",
      hardFailReasons: [],
    });
    expect(qa.scores.semanticParity).toBe(1);
  });

  it("requires Hangul signal for Korean target copy after protected terms are removed", () => {
    const qa = validateAdTranscreationDeterministically({
      sourceLocale: "en-US",
      targetLocale: "ko-KR",
      sourceCreative,
      targetCreative: {
        headline: "Cedar Bean latte reward",
        supportingCopy: "Your afternoon latte comes with a cookie.",
        imageAltText: "Cedar Bean latte and cookie",
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(qa.decision).toBe("repair");
    expect(qa.hardFailReasons).toContain("WRONG_LANGUAGE");
  });

  it("fails when a protected source term is changed", () => {
    const qa = validateAdTranscreationDeterministically({
      sourceLocale: "en-US",
      targetLocale: "es-US",
      sourceCreative,
      targetCreative: {
        headline: "Café Cedar con latte",
        supportingCopy: "Tu latte de la tarde viene con una galleta.",
        imageAltText: "Latte y galleta en Café Cedar",
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(qa.decision).toBe("repair");
    expect(qa.hardFailReasons).toContain("PROTECTED_TERM_CHANGED");
  });

  it("blocks unsupported claims and offer-fact drift", () => {
    const qa = validateAdTranscreationDeterministically({
      sourceLocale: "en-US",
      targetLocale: "es-US",
      sourceCreative,
      targetCreative: {
        headline: "Cedar Bean tiene el mejor latte orgánico",
        supportingCopy: "Recibe 3 cookies garantizadas con tu latte.",
        imageAltText: "Latte y cookie en Cedar Bean",
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(qa.decision).toBe("block");
    expect(qa.hardFailReasons).toEqual(expect.arrayContaining(["OFFER_FACT_DRIFT", "UNSUPPORTED_CLAIM"]));
  });

  it("flags banned BOGO shorthand in any target locale", () => {
    const qa = validateAdTranscreationDeterministically({
      sourceLocale: "en-US",
      targetLocale: "es-US",
      sourceCreative,
      targetCreative: {
        headline: "Cedar Bean 2x1 en latte",
        supportingCopy: "Tu latte viene con una cookie.",
        imageAltText: "Latte y cookie en Cedar Bean",
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(qa.decision).toBe("repair");
    expect(qa.hardFailReasons).toContain("BANNED_SHORTHAND");
  });
});
