import { describe, expect, it } from "vitest";

import { validateDealEligibility, type DealEligibilityInput } from "./deal-eligibility";
import {
  buildOfferDefinitionV1,
  buildOfferDisclosureLine,
  canonicalOfferSentence,
  validateOfferDefinitionV1,
} from "./offer-definition";

function definitionFor(
  input: DealEligibilityInput,
  overrides: Partial<{
    businessName: string;
    locationName: string;
  }> = {},
) {
  const eligibilityResult = validateDealEligibility(input);
  const definition = buildOfferDefinitionV1({
    businessId: "biz_123",
    businessName: overrides.businessName ?? "Merit Coffee",
    locationId: "loc_123",
    locationName: overrides.locationName ?? "Merit Coffee - Deep Ellum",
    dealEligibility: input,
    eligibilityResult,
    activeWindowHumanReadable: "Today 2:00 PM to 4:00 PM",
    quantityLimit: 20,
    redemptionLimit: "Claims close 15 minutes before the deal ends.",
    schedule: {
      mode: "one_time",
      summary: "Today 2:00 PM to 4:00 PM",
      startsAt: "2026-06-22T14:00:00-05:00",
      endsAt: "2026-06-22T16:00:00-05:00",
      timeZone: "America/Chicago",
    },
    sourceAssetIds: ["asset_latte_photo_1"],
  });
  if (!definition) throw new Error("expected valid offer definition");
  return definition;
}

describe("OfferDefinitionV1", () => {
  it("builds a same-item BOGO definition with a deterministic canonical sentence", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemId: "sku_latte",
      requiredItemDescription: "latte",
      requiredItemRetailValueCents: 600,
      freeItemQuantity: 1,
      freeItemDescription: "latte",
      freeItemRetailValueCents: 600,
      freeItemDiscountPercent: 100,
    });

    expect(definition.offerType).toBe("buy_one_get_one");
    expect(definition.qualifyingItems).toMatchObject([
      { catalogItemId: "sku_latte", displayName: "latte", quantity: 1 },
    ]);
    expect(definition.reward).toMatchObject({
      rule: "same_item_free",
      discountPercent: 100,
      displayNames: ["latte"],
    });
    expect(definition.canonicalOfferLine).toBe("Buy one latte and get one free");
    expect(canonicalOfferSentence(definition)).toBe("Buy one latte and get one free.");
    expect(validateOfferDefinitionV1(definition)).toEqual({ valid: true, reasonCodes: [] });
  });

  it("builds a different-item free reward definition without duplicating free", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Bacon and egg sandwich",
      freeItemQuantity: 1,
      freeItemDescription: "Free coffee",
      freeItemDiscountPercent: 100,
    });

    expect(definition.offerType).toBe("buy_one_get_reward_item");
    expect(definition.reward).toMatchObject({
      rule: "reward_item_free",
      displayNames: ["coffee"],
    });
    expect(definition.canonicalOfferSentence).toBe(
      "Buy a bacon and egg sandwich and get a free coffee.",
    );
    expect(definition.canonicalOfferSentence).not.toMatch(/free free/i);
  });

  it("builds a percent-off single-item definition", () => {
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemId: "sku_cold_brew",
      itemDescription: "cold brew",
      itemRetailValueCents: 500,
    });

    expect(definition.offerType).toBe("percent_off_single_item");
    expect(definition.reward).toMatchObject({
      rule: "percent_off_single_item",
      discountPercent: 40,
      displayNames: ["cold brew"],
    });
    expect(definition.canonicalOfferSentence).toBe("Get 40% off one cold brew.");
  });

  it("builds disclosure text from location, quantity, schedule, cutoff, and claim limit", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "latte",
      freeItemQuantity: 1,
      freeItemDescription: "latte",
      freeItemDiscountPercent: 100,
    });

    const disclosure = buildOfferDisclosureLine(definition);

    expect(disclosure).toContain("Redeem only at Merit Coffee - Deep Ellum.");
    expect(disclosure).toContain("Limited to 20 available.");
    expect(disclosure).toContain("Offer window: Today 2:00 PM to 4:00 PM.");
    expect(disclosure).toContain("Claims close 15 minutes before the deal ends.");
    expect(disclosure).toContain("Limit one claim per customer.");
    expect(definition.disclosureIds).toEqual([
      "canonical_offer_terms",
      "participating_location_only",
      "one_claim_per_user",
      "while_claims_remain",
      "scheduled_window",
      "claim_cutoff",
    ]);
  });

  it("does not duplicate punctuation for location names ending in punctuation", () => {
    const definition = definitionFor(
      {
        dealType: "BUY_ONE_GET_ONE_FREE",
        appliesTo: "SINGLE_ITEM",
        requiredPurchaseQuantity: 1,
        requiredItemDescription: "latte",
        freeItemQuantity: 1,
        freeItemDescription: "latte",
        freeItemDiscountPercent: 100,
      },
      { businessName: "Bluebird Coffee Co.", locationName: "Bluebird Coffee Co." },
    );

    expect(definition.canonicalTermsLine).toContain("Redeem only at Bluebird Coffee Co.");
    expect(definition.canonicalTermsLine).not.toContain("Co..");
  });

  it("rejects invalid offer definition shapes", () => {
    expect(validateOfferDefinitionV1({ schemaVersion: 1 })).toMatchObject({
      valid: false,
      reasonCodes: expect.arrayContaining([
        "INVALID_STATUS",
        "MISSING_MERCHANT_ID",
        "MISSING_QUALIFYING_ITEM",
        "MISSING_REWARD",
      ]),
    });
  });
});
