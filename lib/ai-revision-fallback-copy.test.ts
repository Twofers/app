import { describe, expect, it } from "vitest";

import { buildDeterministicRevisionFallbackCopy } from "./ai-revision-fallback-copy";
import {
  buildDealOfferContract,
  validateAiCopyAgainstOffer,
  type DealOfferContract,
} from "./deal-offer-contract";
import { validateDealEligibility, type DealEligibilityInput } from "./deal-eligibility";

function contractFor(input: DealEligibilityInput): DealOfferContract {
  const eligibilityResult = validateDealEligibility(input);
  const contract = buildDealOfferContract({
    businessId: "biz_123",
    businessName: "Test Cafe",
    locationId: "loc_123",
    locationName: "Test Cafe",
    dealEligibility: input,
    eligibilityResult,
    activeWindowHumanReadable: "Today 9:00 AM to 11:00 AM",
    quantityLimit: 25,
  });
  if (!contract) throw new Error("expected valid contract");
  return contract;
}

describe("buildDeterministicRevisionFallbackCopy", () => {
  it("rewrites a weak coffee-cookie poster headline from locked offer facts", () => {
    const contract = contractFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Any large coffee drink",
      requiredItemRetailValueCents: 600,
      freeItemQuantity: 1,
      freeItemDescription: "Cookie of your choice",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    });

    const copy = buildDeterministicRevisionFallbackCopy({
      contract,
      feedback: "The top part that says try our any large coffee doesn't make sense.",
      avoidHeadlines: ["Try our any large coffee drink", "Any large coffee drink"],
    });

    expect(copy.headline).toBe("Coffee + cookie break");
    expect(copy.headline).not.toMatch(/try our|any large coffee drink/i);
    expect(copy.short_description).toMatch(/any large coffee drink/i);
    expect(copy.short_description).toMatch(/cookie of your choice/i);
    expect(validateAiCopyAgainstOffer(copy, contract)).toMatchObject({ valid: true });
  });

  it("creates a visibly different same-item BOGO fallback", () => {
    const contract = contractFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "latte",
      requiredItemRetailValueCents: 500,
      freeItemQuantity: 1,
      freeItemDescription: "latte",
      freeItemRetailValueCents: 500,
      freeItemDiscountPercent: 100,
    });

    const copy = buildDeterministicRevisionFallbackCopy({
      contract,
      feedback: "Make the headline sound like a real ad.",
      avoidHeadlines: ["Buy one latte and get one free"],
    });

    expect(copy.headline).toBe("Latte bonus on your order");
    expect(validateAiCopyAgainstOffer(copy, contract)).toMatchObject({ valid: true });
  });

  it("keeps percent-off mechanics exact", () => {
    const contract = contractFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 50,
      itemDescription: "breakfast sandwich",
      itemRetailValueCents: 800,
    });

    const copy = buildDeterministicRevisionFallbackCopy({
      contract,
      feedback: "Make it shorter and clearer.",
      avoidHeadlines: ["Get 50% off one breakfast sandwich"],
    });

    expect(copy.headline).toBe("50% sandwich savings");
    expect(copy.short_description).toContain("50% on one breakfast sandwich");
    expect(validateAiCopyAgainstOffer(copy, contract)).toMatchObject({ valid: true });
  });
});
