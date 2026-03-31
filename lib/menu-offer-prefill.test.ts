import { describe, expect, it } from "vitest";

import { buildQuickPrefillFromMenuOffer } from "./menu-offer-prefill";

describe("buildQuickPrefillFromMenuOffer", () => {
  it("builds trimmed title and hint lines in promo/body/cta order", () => {
    const out = buildQuickPrefillFromMenuOffer(
      {
        creative_lane: "value",
        style_label: "friendly",
        rationale: "value-forward angle",
        visual_direction: "Warm bakery counter shot",
        headline: "  BOGO Latte + Croissant  ",
        subheadline: "Buy one latte, get a croissant free. Perfect for morning commuters.",
        cta: "  Order before 11am  ",
      },
      "loc_1",
    );

    expect(out.prefillTitle).toBe("BOGO Latte + Croissant");
    expect(out.prefillHint).toContain("Buy one latte, get a croissant free.");
    expect(out.prefillHint).toContain("Perfect for morning commuters.");
    expect(out.prefillHint.endsWith("Order before 11am")).toBe(true);
    expect(out.prefillLocationId).toBe("loc_1");
    expect(out.fromMenuOffer).toBe("1");
  });

  it("omits location when not provided", () => {
    const out = buildQuickPrefillFromMenuOffer({
      creative_lane: "premium",
      style_label: "premium",
      rationale: "premium angle",
      visual_direction: "Clean hero beverage visual",
      headline: "Afternoon tea special",
      subheadline: "Limited seats",
      cta: "Reserve now",
    });
    expect(out.prefillLocationId).toBeUndefined();
  });
});
