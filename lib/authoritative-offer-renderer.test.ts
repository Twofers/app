import { describe, expect, it } from "vitest";

import {
  buildLockedOfferContent,
  containsBannedOfferShorthand,
  renderAuthoritativeOfferFromDeal,
  renderAuthoritativeOfferFromDefinition,
} from "./authoritative-offer-renderer";
import { buildOfferDefinitionV1 } from "./offer-definition";

function latteDefinition() {
  const definition = buildOfferDefinitionV1({
    businessId: "11111111-1111-4111-8111-111111111111",
    businessName: "Cedar Bean",
    locationId: "22222222-2222-4222-8222-222222222222",
    locationName: "Main Street",
    dealEligibility: {
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredPurchaseQuantity: 1,
      freeItemQuantity: 1,
      requiredItemDescription: "latte",
      freeItemDescription: "latte",
    },
    eligibilityResult: { eligible: true, eligibilityStatus: "VALID", customerValuePercent: 50 },
    activeWindowHumanReadable: "Today, 11:30 AM-1:00 PM",
    quantityLimit: 20,
  });
  if (!definition) throw new Error("Expected valid definition");
  return definition;
}

describe("authoritative English offer renderer", () => {
  it("renders native offer content from structured offer definitions", () => {
    const content = renderAuthoritativeOfferFromDefinition(latteDefinition());

    expect(content.primaryOfferLine).toBe("Buy one latte and get one free");
    expect(content.compactOfferLine).toBe(content.primaryOfferLine);
    expect(content.termsLine).toContain("Limit one claim per customer.");
    expect(content.accessibilityOfferDescription).toContain(content.primaryOfferLine);
  });

  it("does not accept banned shorthand as the locked offer line", () => {
    expect(containsBannedOfferShorthand("BOGO latte")).toBe(true);
    expect(containsBannedOfferShorthand("2-for-1 latte")).toBe(true);

    const content = buildLockedOfferContent({
      primaryOfferLine: "BOGO latte",
      fallbackOfferLine: "Buy one latte and get one free",
      termsLine: "Limit one claim per customer.",
    });

    expect(content.primaryOfferLine).toBe("Buy one latte and get one free");
  });

  it("recovers from legacy shorthand when structured deal fields are present", () => {
    const content = renderAuthoritativeOfferFromDeal(
      {
        title: "BOGO latte",
        locked_offer_line: "2-for-1 latte",
        deal_type: "BUY_ONE_GET_ONE_FREE",
        required_item_description: "latte",
        free_item_description: "latte",
        required_purchase_quantity: 1,
        free_item_quantity: 1,
      },
      { description: "Offer window applies." },
    );

    expect(content.primaryOfferLine).toBe("Buy one latte and get one free");
    expect(content.primaryOfferLine).not.toMatch(/BOGO|2-for-1/i);
  });
});
