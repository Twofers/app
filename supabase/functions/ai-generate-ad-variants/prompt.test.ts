import { describe, expect, it } from "vitest";

import { buildAdCopyPrompt } from "./prompt.ts";
import { buildDealOfferContract, type DealOfferContract } from "../../../lib/deal-offer-contract.ts";
import { validateDealEligibility, type DealEligibilityInput } from "../../../lib/deal-eligibility.ts";

function contractFor(input: DealEligibilityInput): DealOfferContract {
  const eligibilityResult = validateDealEligibility(input);
  const contract = buildDealOfferContract({
    businessId: "biz_123",
    businessName: "Cedar Street Cafe",
    locationId: "loc_123",
    locationName: "Cedar Street Cafe - Main",
    dealEligibility: input,
    eligibilityResult,
    activeWindowHumanReadable: "Today 11:30 AM to 1:00 PM",
    quantityLimit: 20,
  });
  if (!contract) throw new Error("expected contract");
  return contract;
}

const buySomethingContract = contractFor({
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

const basePrompt = buildAdCopyPrompt({
  itemHint: "Buy one coffee and get a bagel free",
  research: {
    item_name: "coffee and bagel",
    description: "A coffee paired with a bakery-case bagel.",
    is_familiar: true,
  },
  businessName: "Cedar Street Cafe",
  businessContext: {
    category: "Coffee shop",
    location: "Downtown Grapevine",
    tone: "friendly and direct",
    description: "Neighborhood cafe serving espresso and fresh pastries.",
  },
  offerScheduleSummary: "Today 11:30 AM to 1:00 PM",
  quantityLimit: 20,
  redemptionLimit: "Claims close 15 minutes before the deal ends.",
  outputLanguage: "en",
  offerContract: buySomethingContract,
});

describe("buildAdCopyPrompt", () => {
  it("includes anti-generic instructions and banned vague phrases", () => {
    expect(basePrompt.system).toContain("not a generic image caption");
    expect(basePrompt.system).toContain("Avoid generic marketing language");
    expect(basePrompt.system).toContain("Don't miss out");
    expect(basePrompt.system).toContain("Amazing deal");
    expect(basePrompt.system).toContain("Delicious treat");
    expect(basePrompt.system).toContain("Come enjoy our special offer");
  });

  it("includes good and bad examples", () => {
    expect(basePrompt.system).toContain("Bad headlineAlternative");
    expect(basePrompt.system).toContain("Egg sandwich with free coffee");
    expect(basePrompt.system).toContain("Buy an egg sandwich and get a free coffee");
    expect(basePrompt.system).toContain("Buy two muffins and get a free drip coffee");
    expect(basePrompt.system).toContain("Buy one latte and get one free");
  });

  it("passes the locked contract while keeping metadata out of generated fields", () => {
    expect(basePrompt.userText).toContain("Customer buys 1 coffee.");
    expect(basePrompt.userText).toContain("Customer gets 1 bagel free.");
    expect(basePrompt.userText).toContain("The customer does NOT have to buy the free reward item.");
    expect(basePrompt.system).toContain("Do not include street addresses");
    expect(basePrompt.system).toContain("Terms, location, schedule, and quantity are app metadata");
    expect(basePrompt.system).not.toContain("Locked terms line:");
    expect(basePrompt.userText).toContain("Do not include business name, address, availability, or quantity");
    expect(basePrompt.userText).not.toContain("Address context:");
    expect(basePrompt.userText).not.toContain("Time window:");
    expect(basePrompt.userText).not.toContain("Quantity scarcity:");
  });

  it("requires the structured output schema", () => {
    const schema = basePrompt.jsonSchema.schema;
    expect(schema.required).toEqual(["variants"]);
    expect(Object.keys(schema.properties)).toEqual(["variants"]);
    const item = schema.properties.variants.items;
    expect(item.required).toEqual(["headlineAlternative", "description", "pushTitle", "pushBody", "socialCaption"]);
  });

  it("tells the model not to invent missing facts", () => {
    expect(basePrompt.system).toContain("Do not invent missing products");
    expect(basePrompt.userText).toContain("write around it without inventing it");
    expect(basePrompt.userText).toContain("stay neutral instead of naming a latte");
  });

  it("adds buy-one-get-something-free guardrails", () => {
    expect(basePrompt.userText).toContain('Do NOT say "Buy coffee and bagel."');
    expect(basePrompt.userText).toContain('Do NOT say "BOGO."');
    expect(basePrompt.userText).toContain("The customer does NOT have to buy the free reward item.");
    expect(basePrompt.userText).toContain("Normalized deal facts JSON");
    expect(basePrompt.userText).toContain("Deterministic canonical headline: Buy a coffee and get a free bagel");
  });

  it("requires plain English for same-item buy-one-get-one offers", () => {
    const prompt = buildAdCopyPrompt({
      ...basePromptParams("Buy one coffee, get one coffee free", "coffee"),
      offerContract: contractFor({
        dealType: "BUY_ONE_GET_ONE_FREE",
        appliesTo: "SINGLE_ITEM",
        requiredPurchaseQuantity: 1,
        requiredItemDescription: "coffee",
        requiredItemRetailValueCents: 400,
        freeItemQuantity: 1,
        freeItemDescription: "coffee",
        freeItemRetailValueCents: 400,
        freeItemDiscountPercent: 100,
      }),
    });

    expect(prompt.userText).toContain("This is a true same-item buy-one-get-one free deal.");
    expect(prompt.userText).toContain('Do not use:');
    expect(prompt.userText).toContain("Buy one coffee and get one free");
  });

  it("bans BOGO, free, and entire-order language for percent-off deals", () => {
    const prompt = buildAdCopyPrompt({
      ...basePromptParams("40% off one latte", "latte"),
      offerContract: contractFor({
        dealType: "PERCENT_OFF_SINGLE_ITEM",
        appliesTo: "SINGLE_ITEM",
        discountPercent: 40,
        itemDescription: "latte",
        itemRetailValueCents: 600,
      }),
    });

    expect(prompt.userText).toContain("This is not a BOGO deal.");
    expect(prompt.userText).toContain('Do not mention "free."');
    expect(prompt.userText).toContain('Do not mention "entire order."');
  });
});

function basePromptParams(itemHint: string, itemName: string) {
  return {
    itemHint,
    research: {
      item_name: itemName,
      description: "",
      is_familiar: true,
    },
    businessName: "Cedar Street Cafe",
    businessContext: {
      category: "Coffee shop",
      location: "Downtown Grapevine",
      tone: "friendly and direct",
      description: "Neighborhood cafe serving espresso and fresh pastries.",
    },
    offerScheduleSummary: "Today 11:30 AM to 1:00 PM",
    quantityLimit: 20,
    redemptionLimit: "Claims close 15 minutes before the deal ends.",
    outputLanguage: "en" as const,
  };
}
