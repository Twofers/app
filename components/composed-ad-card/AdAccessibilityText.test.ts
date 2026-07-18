import { describe, expect, it } from "vitest";

import { buildComposedAdAccessibilityLabel } from "./AdAccessibilityText";

describe("buildComposedAdAccessibilityLabel", () => {
  it("does not duplicate punctuation when parts already end with punctuation", () => {
    const label = buildComposedAdAccessibilityLabel({
      merchant: { name: "Bluebird Coffee Co.", locationName: null, addressLine: null, logoUri: null },
      liveState: {
        status: "live",
        statusLabel: "Live.",
        quantityRemainingLabel: null,
        timeRemainingLabel: "Jul 10, 2026 to Jul 17, 2026.",
        claimAvailable: true,
      },
      copy: {
        headline: "Buy one latte and get one free.",
        supportingCopy: "Bring a friend.",
        ctaLabel: "Claim.",
        imageAltText: null,
      },
      offerFacts: {
        primaryOfferLine: "Buy one latte and get one free.",
        compactOfferLine: "Buy one latte and get one free.",
        termsLine: "Redeem only at Bluebird Coffee Co. Limited to 100 available. Limit one claim per customer.",
        accessibilityOfferDescription: "Buy one latte and get one free.",
      },
    });

    expect(label).not.toContain("..");
    expect(label).toContain("Bluebird Coffee Co. Live");
    expect(label).toContain("customer");
  });
});
