import { describe, expect, it, vi } from "vitest";

import {
  buildDealOfferContract,
  deterministicFallbackCopy,
  generateValidatedDealCopy,
  validateAiCopyAgainstOffer,
  type AiDealCopyVariant,
  type DealOfferContract,
} from "./deal-offer-contract";
import { validateDealEligibility, type DealEligibilityInput } from "./deal-eligibility";

function contractFor(input: DealEligibilityInput): DealOfferContract {
  const eligibilityResult = validateDealEligibility(input);
  const contract = buildDealOfferContract({
    businessId: "biz_123",
    businessName: "Merit Coffee",
    locationId: "loc_123",
    locationName: "Merit Coffee - Deep Ellum",
    dealEligibility: input,
    eligibilityResult,
    activeWindowHumanReadable: "Today 2:00 PM to 4:00 PM",
    quantityLimit: 20,
  });
  if (!contract) throw new Error("expected valid contract");
  return contract;
}

const coffeeBagelContract = contractFor({
  dealType: "BUY_ONE_GET_SOMETHING_FREE",
  appliesTo: "SINGLE_ITEM",
  requiredPurchaseQuantity: 1,
  requiredItemDescription: "coffee",
  requiredItemRetailValueCents: 400,
  freeItemQuantity: 1,
  freeItemDescription: "bagel",
  freeItemRetailValueCents: 300,
  freeItemDiscountPercent: 100,
});

function copy(overrides: Partial<AiDealCopyVariant>): AiDealCopyVariant {
  return {
    headline: "Coffee with a free bagel",
    short_description: "Buy a coffee, get a bagel free.",
    push_notification: "Buy coffee, get bagel free.",
    social_caption: "Buy a coffee and enjoy a free bagel at Merit Coffee.",
    ...overrides,
  };
}

function copyText(text: string): AiDealCopyVariant {
  return {
    headline: text,
    short_description: text,
    push_notification: text,
    social_caption: text,
  };
}

describe("buildDealOfferContract", () => {
  it("builds canonical copy for BUY_ONE_GET_ONE_FREE", () => {
    const contract = contractFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "coffee",
      requiredItemRetailValueCents: 400,
      freeItemQuantity: 1,
      freeItemDescription: "coffee",
      freeItemRetailValueCents: 400,
      freeItemDiscountPercent: 100,
    });

    expect(contract.canonicalOfferLine).toBe("Buy one coffee, get one coffee free.");
    expect(contract.canonicalShortTerms).toContain("Purchase 1 coffee to receive 1 coffee free.");
  });

  it("builds canonical copy for BUY_ONE_GET_SOMETHING_FREE", () => {
    expect(coffeeBagelContract.canonicalOfferLine).toBe("Buy one coffee, get one bagel free.");
    expect(coffeeBagelContract.canonicalShortTerms).toContain("Purchase 1 coffee to receive 1 bagel free.");
  });

  it("builds canonical copy for PERCENT_OFF_SINGLE_ITEM", () => {
    const contract = contractFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "latte",
      itemRetailValueCents: 600,
    });

    expect(contract.canonicalOfferLine).toBe("40% off one latte.");
    expect(contract.canonicalShortTerms).toContain("Get 40% off one latte.");
  });

  it("returns null for invalid deals before AI generation", () => {
    const input: DealEligibilityInput = {
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 20,
      itemDescription: "latte",
      itemRetailValueCents: 600,
    };

    expect(
      buildDealOfferContract({
        businessId: "biz_123",
        businessName: "Merit Coffee",
        dealEligibility: input,
        eligibilityResult: validateDealEligibility(input),
      }),
    ).toBeNull();
  });
});

describe("validateAiCopyAgainstOffer", () => {
  it("allows clear buy-one-get-something-free copy", () => {
    for (const validText of [
      "Buy a coffee, get a bagel free.",
      "Grab a coffee and enjoy a free bagel.",
      "Your coffee comes with a free bagel.",
    ]) {
      const result = validateAiCopyAgainstOffer(copyText(validText), coffeeBagelContract);
      expect(result.valid, validText).toBe(true);
    }
  });

  it("rejects buy-one-get-something-free copy that becomes generic BOGO", () => {
    for (const invalidText of [
      "Buy a coffee and bagel, get one free.",
      "BOGO coffee and bagels.",
      "Buy coffee + bagel and get one free.",
      "Buy both and get one free.",
      "Buy a coffee and get one free.",
    ]) {
      const result = validateAiCopyAgainstOffer(copyText(invalidText), coffeeBagelContract);
      expect(result.valid, invalidText).toBe(false);
    }
  });

  it("allows true same-item BOGO language and rejects changed mechanics", () => {
    const contract = contractFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "coffee",
      requiredItemRetailValueCents: 400,
      freeItemQuantity: 1,
      freeItemDescription: "coffee",
      freeItemRetailValueCents: 400,
      freeItemDiscountPercent: 100,
    });

    expect(validateAiCopyAgainstOffer(copyText("BOGO coffee today."), contract).valid).toBe(true);
    expect(validateAiCopyAgainstOffer(copyText("Buy one coffee, get one coffee free."), contract).valid).toBe(true);
    expect(validateAiCopyAgainstOffer(copyText("Buy one coffee, get a bagel free."), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("Buy two coffees, get one free."), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("Buy one coffee, get the second 50% off."), contract).valid).toBe(false);
  });

  it("allows 40% single-item discounts and rejects free or order-wide language", () => {
    const contract = contractFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "latte",
      itemRetailValueCents: 600,
    });

    expect(validateAiCopyAgainstOffer(copyText("40% off one latte."), contract).valid).toBe(true);
    expect(validateAiCopyAgainstOffer(copyText("Save 40% on one latte."), contract).valid).toBe(true);
    expect(validateAiCopyAgainstOffer(copyText("BOGO latte."), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("Buy one latte, get one free."), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("40% off your entire order."), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("Get a free latte."), contract).valid).toBe(false);
  });
});

describe("generateValidatedDealCopy", () => {
  it("buy_one_get_something_free_does_not_become_generic_bogo", async () => {
    const bad = copy({
      headline: "BOGO coffee and bagels",
      short_description: "Buy a coffee and bagel, get one free.",
      push_notification: "BOGO coffee and bagels today.",
      social_caption: "Buy coffee and bagel and get one free.",
    });
    const good = copy({
      headline: "Coffee with a free bagel",
      short_description: "Grab a coffee and enjoy a free bagel at Merit Coffee.",
      push_notification: "Buy coffee, get bagel free.",
      social_caption: "Limited-time Twofer: buy a coffee and enjoy a free bagel.",
    });
    const requestCopy = vi.fn<(context: { attemptNumber: 1 | 2; validationFeedback?: string }) => Promise<AiDealCopyVariant[]>>();
    requestCopy.mockResolvedValueOnce([bad]).mockResolvedValueOnce([good]);

    const result = await generateValidatedDealCopy({
      contract: coffeeBagelContract,
      requestCopy,
    });

    expect(requestCopy).toHaveBeenCalledTimes(2);
    expect(result.copy_source).toBe("AI_RETRY_VALIDATED");
    expect(result.locked_offer_line).toBe("Buy one coffee, get one bagel free.");
    expect(`${result.headline} ${result.short_description} ${result.push_notification}`).not.toMatch(/\bBOGO\b/i);
    expect(result.short_description).not.toMatch(/buy (?:a )?coffee and bagel/i);
  });

  it("uses deterministic fallback after repeated invalid AI output", async () => {
    const bad = copy({
      headline: "BOGO coffee and bagels",
      short_description: "Buy coffee + bagel and get one free.",
      push_notification: "BOGO coffee and bagels today.",
      social_caption: "Buy both and get one free.",
    });
    const requestCopy = vi.fn().mockResolvedValue([bad]);

    const result = await generateValidatedDealCopy({
      contract: coffeeBagelContract,
      requestCopy,
    });

    expect(requestCopy).toHaveBeenCalledTimes(2);
    expect(result.copy_source).toBe("DETERMINISTIC_FALLBACK");
    expect(result.short_description).toContain("Buy one coffee");
    expect(result.short_description).toContain("get one bagel free");
    expect(validateAiCopyAgainstOffer(deterministicFallbackCopy(coffeeBagelContract), coffeeBagelContract).valid).toBe(true);
  });
});
