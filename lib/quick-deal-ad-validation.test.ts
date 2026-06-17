import { describe, expect, it } from "vitest";

import { validateDealEligibility, type DealEligibilityInput } from "./deal-eligibility";
import { validateQuickDealAd } from "./quick-deal-ad-validation";

function contextFor(dealEligibility: DealEligibilityInput) {
  const eligibilityResult = validateDealEligibility(dealEligibility);
  return {
    businessId: "biz_123",
    businessName: "Test Cafa",
    locationName: "9460 N MacArthur Blvd, Irving, TX 75063, USA",
    dealEligibility,
    eligibilityResult,
  };
}

const bagelCoffeeInput: DealEligibilityInput = {
  dealType: "BUY_ONE_GET_SOMETHING_FREE",
  appliesTo: "SINGLE_ITEM",
  requiredPurchaseQuantity: 1,
  requiredItemDescription: "Bagle",
  requiredItemRetailValueCents: 300,
  freeItemQuantity: 1,
  freeItemDescription: "Coffee",
  freeItemRetailValueCents: 300,
  freeItemDiscountPercent: 100,
};

describe("validateQuickDealAd", () => {
  it("passes the repaired screenshot fixture", () => {
    const result = validateQuickDealAd(
      {
        headline: "Bagel with a free coffee",
        offer: "Buy one bagel, get one coffee free.",
        cta: "Claim deal",
      },
      contextFor(bagelCoffeeInput),
    );

    expect(result.ok).toBe(true);
    expect(result.blockingErrors).toEqual([]);
    expect(result.quality?.blocked).toBe(false);
    expect(result.quality?.tier).toBe("strong");
  });

  it("blocks screenshot-style metadata even when the offer mentions value", () => {
    const result = validateQuickDealAd(
      {
        headline: "Bagels and free coffee",
        offer:
          "Buy one Bagle and get one Coffee free at Test Cafa, 9460 N MacArthur Blvd, Irving, TX 75063, USA. Available 6/16/2026 7:29 PM to 6/23/2026 7:29 PM. 50 available.",
        cta: "Claim deal",
      },
      contextFor(bagelCoffeeInput),
    );

    expect(result.ok).toBe(false);
    expect(result.blockingErrors.map((error) => error.ruleId)).toContain("RULE_NO_METADATA_IN_COPY");
  });

  it("blocks preview-ready state when final release rules would fail", () => {
    const result = validateQuickDealAd(
      {
        headline: "Weekly cafe deal",
        offer: "Available this week.",
        cta: "Claim deal",
      },
      contextFor(bagelCoffeeInput),
    );

    expect(result.ok).toBe(false);
    expect(result.blockingErrors.map((error) => error.ruleId)).toEqual(
      expect.arrayContaining(["RULE_VALUE_PRESENT", "RULE_STRONG_DEAL_REQUIRED"]),
    );
  });
});
