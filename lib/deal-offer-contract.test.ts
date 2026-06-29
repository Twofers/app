import { describe, expect, it, vi } from "vitest";

import {
  buildCanonicalHeadlineFromFacts,
  buildDealOfferContract,
  buildHeadlineCandidates,
  buildOfferCopyCandidates,
  buildRequiredVisualItems,
  canonicalizeOfferItem,
  deterministicFallbackCopy,
  generateValidatedDealCopy,
  parseAiDealCopyVariants,
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
    headline: "Buy a coffee and get a free bagel",
    short_description: "Buy a coffee and the bagel is on us.",
    push_notification: "Claim the coffee deal and get a free bagel.",
    social_caption: "Buy a coffee and get a free bagel at Merit Coffee.",
    ...overrides,
  };
}

function copyText(text: string, description = "Buy a coffee and the bagel is on us."): AiDealCopyVariant {
  return {
    headline: text,
    short_description: description,
    push_notification: text.replace(/[.!?]+$/g, ""),
    social_caption: `${text.replace(/[.!?]+$/g, "")} at the shop.`,
  };
}

describe("buildDealOfferContract", () => {
  it("canonicalizes common food item typos without touching merchant metadata", () => {
    expect(canonicalizeOfferItem("Bagle")).toEqual({
      original: "Bagle",
      canonical: "bagel",
      confidence: "high",
      source: "known_food_dictionary",
    });
    expect(canonicalizeOfferItem("Coffee").canonical).toBe("coffee");
    expect(canonicalizeOfferItem("Test Cafa").canonical).toBe("Test Cafa");
  });

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

    expect(contract.canonicalOfferLine).toBe("Buy one coffee and get one free");
    expect(contract.canonicalShortTerms).toContain("Purchase 1 coffee to receive 1 coffee free.");
  });

  it("builds canonical copy for BUY_ONE_GET_SOMETHING_FREE", () => {
    expect(coffeeBagelContract.canonicalOfferLine).toBe("Buy a coffee and get a free bagel");
    expect(coffeeBagelContract.canonicalShortTerms).toContain("Purchase 1 coffee to receive 1 bagel free.");
  });

  it("builds the required golden canonical headlines", () => {
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 1,
      buyItem: "egg sandwich",
      rewardQuantity: 1,
      rewardItem: "coffee",
      rewardType: "free",
    })).toBe("Buy an egg sandwich and get a free coffee");
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 1,
      buyItem: "latte",
      rewardQuantity: 1,
      rewardItem: "latte",
      rewardType: "free",
    })).toBe("Buy one latte and get one free");
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 2,
      buyItem: "muffin",
      rewardQuantity: 1,
      rewardItem: "drip coffee",
      rewardType: "free",
    })).toBe("Buy two muffins and get a free drip coffee");
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 1,
      buyItem: "apple turnover",
      rewardQuantity: 1,
      rewardItem: "espresso",
      rewardType: "free",
    })).toBe("Buy an apple turnover and get a free espresso");
  });

  it("handles articles, quantities, capitalization, hyphens, and long item names", () => {
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 1,
      buyItem: "an oat-milk latte",
      rewardQuantity: 1,
      rewardItem: "cookie",
      rewardType: "free",
    })).toBe("Buy an oat-milk latte and get a free cookie");
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 1,
      buyItem: "12 oz Merit Reserve cold brew",
      rewardQuantity: 1,
      rewardItem: "blueberry scone",
      rewardType: "free",
    })).toBe("Buy a 12 oz Merit Reserve cold brew and get a free blueberry scone");
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 1,
      buyItem: "La Colombe draft latte",
      rewardQuantity: 2,
      rewardItem: "mini-cookie",
      rewardType: "free",
    })).toBe("Buy a La Colombe draft latte and get two free mini-cookies");
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 1,
      buyItem: "very long seasonal roasted vegetable breakfast sandwich with chipotle aioli",
      rewardQuantity: 1,
      rewardItem: "house drip coffee",
      rewardType: "free",
    })).toContain("very long seasonal roasted vegetable breakfast sandwich with chipotle aioli");
  });

  it("falls back safely for missing reward item", () => {
    expect(buildCanonicalHeadlineFromFacts({
      merchantName: "Cafe",
      buyQuantity: 1,
      buyItem: "latte",
      rewardType: "free",
    })).toBe("Review offer details");
  });

  it("builds a structured fixture for buy bagel get coffee without ad-copy metadata", () => {
    const quickDealBuyBagelGetCoffeeFreeFixture = contractFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Bagle",
      requiredItemRetailValueCents: 300,
      freeItemQuantity: 1,
      freeItemDescription: "Coffee",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    });

    expect(quickDealBuyBagelGetCoffeeFreeFixture.canonicalOfferLine).toBe("Buy a bagel and get a free coffee");
    expect(buildHeadlineCandidates(quickDealBuyBagelGetCoffeeFreeFixture)).toEqual([
      "Buy a bagel and get a free coffee",
      "Get a free coffee with a bagel",
      "Claim a free coffee with bagel",
    ]);
    expect(buildOfferCopyCandidates(quickDealBuyBagelGetCoffeeFreeFixture)[0]).toBe(
      "Buy a bagel and get a free coffee.",
    );
    expect(buildRequiredVisualItems(quickDealBuyBagelGetCoffeeFreeFixture)).toEqual(["bagel", "coffee"]);

    const fallback = deterministicFallbackCopy(quickDealBuyBagelGetCoffeeFreeFixture);
    expect(fallback.headline).toBe("Buy a bagel and get a free coffee");
    expect(fallback.short_description).toBe("Buy a bagel and the coffee is on us.");
    expect(fallback.short_description).not.toMatch(/qualifying purchase|included after/i);
    expect(fallback.short_description).not.toMatch(/MacArthur|Irving|75063|Available|2026|50 available/i);
    expect(validateAiCopyAgainstOffer(fallback, quickDealBuyBagelGetCoffeeFreeFixture).valid).toBe(true);
  });

  it("normalizes a free-item field that repeats the word free", () => {
    const contract = contractFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Bacon and egg sandwich",
      freeItemQuantity: 1,
      freeItemDescription: "Free coffee",
      freeItemDiscountPercent: 100,
    });

    expect(contract.canonicalOfferLine).toBe("Buy a bacon and egg sandwich and get a free coffee");
    expect(contract.freeReward?.itemName).toBe("coffee");
    expect(buildRequiredVisualItems(contract)).toEqual(["Bacon and egg sandwich", "coffee"]);

    const fallback = deterministicFallbackCopy(contract);
    expect(fallback.short_description).not.toMatch(/free free/i);
    expect(validateAiCopyAgainstOffer(fallback, contract).valid).toBe(true);
  });

  it("does not strip free from required item names", () => {
    const contract = contractFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Free range egg sandwich",
      freeItemQuantity: 1,
      freeItemDescription: "a free coffee",
      freeItemDiscountPercent: 100,
    });

    expect(contract.requiredPurchase?.itemName).toBe("Free range egg sandwich");
    expect(contract.freeReward?.itemName).toBe("coffee");
  });

  it("builds canonical copy for PERCENT_OFF_SINGLE_ITEM", () => {
    const contract = contractFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "latte",
      itemRetailValueCents: 600,
    });

    expect(contract.canonicalOfferLine).toBe("Get 40% off one latte");
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
      "Buy a coffee and get a free bagel",
      "Get a free bagel when you buy a coffee",
      "Order a coffee and claim a free bagel",
    ]) {
      const result = validateAiCopyAgainstOffer(copy({ headline: validText, push_notification: validText }), coffeeBagelContract);
      expect(result.valid, validText).toBe(true);
    }
    expect(validateAiCopyAgainstOffer(copy({
      headline: "Coffee run bonus",
      short_description: "Buy a coffee and the bagel is on us.",
      push_notification: "Buy a coffee and get a free bagel.",
      social_caption: "Coffee run bonus: buy a coffee and get a free bagel.",
    }), coffeeBagelContract).valid).toBe(true);
  });

  it("rejects buy-one-get-something-free copy that becomes generic BOGO", () => {
    for (const invalidText of [
      "Buy a coffee and bagel, get one free.",
      "B.O.G.O. coffee and bagels.",
      "BOGO coffee and bagels.",
      "Buy coffee + bagel and get one free.",
      "Buy both and get one free.",
      "Buy a coffee and get one free.",
    ]) {
      const result = validateAiCopyAgainstOffer(copyText(invalidText), coffeeBagelContract);
      expect(result.valid, invalidText).toBe(false);
    }
  });

  it("rejects offer copy that leaks address, date, or inventory metadata", () => {
    const badScreenshotCopy = copy({
      headline: "Bagels and free coffee",
      short_description:
        "Buy one Bagle and get one Coffee free at Test Cafa, 9460 N MacArthur Blvd, Irving, TX 75063, USA. Available 6/16/2026 7:29 PM to 6/23/2026 7:29 PM. 50 available.",
      push_notification: "Buy Bagle, get Coffee free.",
      social_caption: "Buy Bagle, get Coffee free.",
    });
    const contract = contractFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Bagle",
      requiredItemRetailValueCents: 300,
      freeItemQuantity: 1,
      freeItemDescription: "Coffee",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    });

    const result = validateAiCopyAgainstOffer(badScreenshotCopy, contract);
    expect(result.valid).toBe(false);
    expect(result.reasonCodes).toContain("COPY_CONTAINS_METADATA");
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

    expect(validateAiCopyAgainstOffer(copy({
      headline: "Buy one coffee and get one free",
      short_description: "Buy a coffee and the next one is on us.",
      push_notification: "Buy one coffee and get one free",
      social_caption: "Buy one coffee and get one free at Merit Coffee.",
    }), contract).valid).toBe(true);
    expect(validateAiCopyAgainstOffer(copy({
      headline: "Buy one coffee and get a free coffee",
      short_description: "Buy a coffee and the next one is on us.",
      push_notification: "Buy one coffee and get a free coffee",
      social_caption: "Buy one coffee and get a free coffee at Merit Coffee.",
    }), contract).valid).toBe(true);
    expect(validateAiCopyAgainstOffer(copyText("Buy one coffee and get a free bagel"), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("Buy two coffees and get one free"), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("Buy one coffee and get the second 50% off"), contract).valid).toBe(false);
  });

  it("allows 40% single-item discounts and rejects free or order-wide language", () => {
    const contract = contractFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "latte",
      itemRetailValueCents: 600,
    });

    expect(validateAiCopyAgainstOffer(copy({
      headline: "Get 40% off one latte",
      short_description: "Save 40% on one latte.",
      push_notification: "Get 40% off one latte",
      social_caption: "Get 40% off one latte at the shop.",
    }), contract).valid).toBe(true);
    expect(validateAiCopyAgainstOffer(copy({
      headline: "Save 40% on one latte",
      short_description: "Get 40% off one latte.",
      push_notification: "Save 40% on one latte",
      social_caption: "Save 40% on one latte at the shop.",
    }), contract).valid).toBe(true);
    expect(validateAiCopyAgainstOffer(copyText("BOGO latte."), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("Buy one latte and get one free"), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("40% off your entire order."), contract).valid).toBe(false);
    expect(validateAiCopyAgainstOffer(copyText("Get a free latte."), contract).valid).toBe(false);
  });

  it("rejects malformed, fragmentary, duplicated, and hallucinated model output", () => {
    expect(validateAiCopyAgainstOffer(copy({ headline: "Coffee with free bagel" }), coffeeBagelContract).reasonCodes)
      .toContain("HEADLINE_WITH_FREE_FRAGMENT");
    expect(validateAiCopyAgainstOffer(copy({ headline: "**Buy a coffee and get a free bagel**" }), coffeeBagelContract).reasonCodes)
      .toContain("COPY_SYNTAX_LEAK");
    expect(validateAiCopyAgainstOffer(copy({
      headline: "Buy a coffee and get a free bagel",
      short_description: "Buy a coffee and get a free bagel",
    }), coffeeBagelContract).reasonCodes).toContain("DUPLICATE_HEADLINE_DESCRIPTION");
    expect(validateAiCopyAgainstOffer(copy({
      headline: "Buy a coffee and get a free bagel",
      short_description: "Buy a coffee and the bagel is on us for $5.",
    }), coffeeBagelContract).reasonCodes).toContain("UNSUPPORTED_PRICE");
    expect(validateAiCopyAgainstOffer(copy({
      headline: "Buy a coffee and get a free bagel",
      short_description: "The free bagel is included after the qualifying coffee purchase.",
    }), coffeeBagelContract).reasonCodes).toContain("FORBIDDEN_AI_PHRASE");
    expect(validateAiCopyAgainstOffer(copyText("Buy a coffee and get two free bagels"), coffeeBagelContract).valid)
      .toBe(false);
  });

  it("parses all five creative lanes and preserves scoring metadata", () => {
    const variants = parseAiDealCopyVariants(JSON.stringify({
      creativeBrief: { exactCustomerHook: "breakfast is included" },
      variants: [
        {
          candidateId: "lane_1",
          strategyId: "value_clarity",
          strategyReason: "Lead with the exchange.",
          headlineAlternative: "Coffee gets the bagel",
          description: "Buy a coffee and the bagel is on us.",
          pushTitle: "Coffee + bagel",
          pushBody: "Buy a coffee and get a free bagel.",
          socialCaption: "Buy a coffee and get a free bagel.",
          cta: "Claim deal",
          imageBrief: "Coffee and bagel on a cafe table.",
          merchantSpecificContextLimited: false,
          preliminaryScore: 82,
          judgeScore: 110,
        },
        {
          candidateId: "lane_2",
          strategyId: "social_or_occasion",
          strategyReason: "Use the morning routine.",
          headlineAlternative: "Bring breakfast to the break",
          description: "Buy a coffee and the bagel is on us.",
          pushTitle: "Breakfast is included",
          pushBody: "Claim coffee and get a free bagel.",
          socialCaption: "Coffee run plus a free bagel.",
          cta: "Claim deal",
          imageBrief: "Two breakfast items on a table.",
          merchantSpecificContextLimited: false,
        },
        {
          candidateId: "lane_3",
          strategyId: "product_desire",
          strategyReason: "Make the item concrete.",
          headlineAlternative: "Coffee plus a bakery-case bagel",
          description: "Buy a coffee and the bagel is on us.",
          pushTitle: "Coffee and bagel",
          pushBody: "Buy a coffee and claim the bagel free.",
          socialCaption: "Coffee plus a free bagel.",
          cta: "Claim deal",
          imageBrief: "Coffee beside an accurate bagel.",
          merchantSpecificContextLimited: false,
        },
        {
          candidateId: "lane_4",
          strategyId: "local_discovery",
          strategyReason: "Invite a visit.",
          headlineAlternative: "Try Cedar Street with breakfast",
          description: "Buy a coffee and the bagel is on us.",
          pushTitle: "Try the coffee deal",
          pushBody: "Buy a coffee and get a free bagel.",
          socialCaption: "Stop by for coffee and a free bagel.",
          cta: "Claim deal",
          imageBrief: "Cafe table with coffee and bagel.",
          merchantSpecificContextLimited: false,
        },
        {
          candidateId: "lane_5",
          strategyId: "merchant_specific",
          strategyReason: "Use the coffee-run habit.",
          headlineAlternative: "Your coffee run gets breakfast",
          description: "Buy a coffee and the bagel is on us.",
          pushTitle: "Coffee run bonus",
          pushBody: "Buy a coffee and get a free bagel.",
          socialCaption: "Coffee run, bagel included.",
          cta: "Claim deal",
          imageBrief: "Coffee run breakfast pairing.",
          merchantSpecificContextLimited: false,
        },
      ],
    }));

    expect(variants).toHaveLength(5);
    expect(variants[0]).toMatchObject({
      candidate_id: "lane_1",
      strategy_id: "value_clarity",
      preliminary_score: 82,
      judge_score: 110,
      cta: "Claim deal",
    });
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
      headline: "Coffee run bonus",
      short_description: "Buy a coffee and the bagel is on us.",
      push_notification: "Claim the coffee deal and get a free bagel.",
      social_caption: "Buy a coffee and get a free bagel at Merit Coffee.",
    });
    const requestCopy = vi.fn<(context: { attemptNumber: 1 | 2; validationFeedback?: string }) => Promise<AiDealCopyVariant[]>>();
    requestCopy.mockResolvedValueOnce([bad]).mockResolvedValueOnce([good]);

    const result = await generateValidatedDealCopy({
      contract: coffeeBagelContract,
      requestCopy,
    });

    expect(requestCopy).toHaveBeenCalledTimes(2);
    expect(result.copy_source).toBe("AI_RETRY_VALIDATED");
    expect(result.locked_offer_line).toBe("Buy a coffee and get a free bagel");
    expect(result.headline).toBe("Coffee run bonus");
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
    expect(result.headline).toBe("Buy a coffee and get a free bagel");
    expect(result.short_description).toContain("bagel is on us");
    expect(result.short_description).not.toMatch(/qualifying purchase|included after/i);
    expect(result.fallback_reason).toBeTruthy();
    expect(validateAiCopyAgainstOffer(deterministicFallbackCopy(coffeeBagelContract), coffeeBagelContract).valid).toBe(true);
    const latteContract = contractFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "12 oz hot latte",
      requiredItemRetailValueCents: 525,
      freeItemQuantity: 1,
      freeItemDescription: "12 oz hot latte",
      freeItemRetailValueCents: 525,
      freeItemDiscountPercent: 100,
    });
    expect(validateAiCopyAgainstOffer(deterministicFallbackCopy(latteContract), latteContract).valid).toBe(true);
  });

  it("falls back when the model times out or throws", async () => {
    const result = await generateValidatedDealCopy({
      contract: coffeeBagelContract,
      requestCopy: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    expect(result.copy_source).toBe("DETERMINISTIC_FALLBACK");
    expect(result.headline).toBe("Buy a coffee and get a free bagel");
    expect(result.fallback_reason).toMatch(/MODEL_REQUEST_FAILED/);
  });
});
