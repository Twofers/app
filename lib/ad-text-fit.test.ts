import { describe, expect, it } from "vitest";

import { estimateAdTextFit } from "./ad-text-fit";

const baseInput = {
  approvedCopy: {
    headline: "Bring a friend for lunch today",
    supportingCopy: "Freshly made and ready when you are.",
    ctaLabel: "Claim deal",
  },
  lockedOfferContent: {
    primaryOfferLine: "Buy one entree, get one entree free",
    compactOfferLine: "Entree BOGO",
    termsLine: "Equal or lesser value.",
    accessibilityOfferDescription: "Buy one entree, get one entree free. Equal or lesser value.",
  },
  merchantIdentity: {
    name: "Cedar House Cafe",
  },
  ctaLabel: "Claim deal",
  statusLabels: ["12 left", "Ends soon"],
};

describe("ad text fit estimator", () => {
  it("keeps normal merchant preview copy intact", () => {
    const result = estimateAdTextFit({
      ...baseInput,
      templateId: "hero_image_overlay",
    });

    expect(result.fits).toBe(true);
    expect(result.offerLine).toBe(baseInput.lockedOfferContent.primaryOfferLine);
    expect(result.showSupportingCopy).toBe(true);
    expect(result.repairCodes).toEqual([]);
  });

  it("uses the compact offer line before changing templates", () => {
    const result = estimateAdTextFit({
      ...baseInput,
      lockedOfferContent: {
        ...baseInput.lockedOfferContent,
        primaryOfferLine: "Buy one large specialty entree, receive one large specialty entree for free during the lunch rush",
        compactOfferLine: "Large entree BOGO",
      },
      templateId: "hero_image_overlay",
    });

    expect(result.offerFits).toBe(true);
    expect(result.offerLine).toBe("Large entree BOGO");
    expect(result.repairCodes).toContain("USE_COMPACT_OFFER_LINE");
  });

  it("flags split-panel headline overflow for copy repair", () => {
    const result = estimateAdTextFit({
      ...baseInput,
      approvedCopy: {
        ...baseInput.approvedCopy,
        headline: "Bring everyone you know for an exceptionally long neighborhood lunch special that cannot fit",
      },
      templateId: "split_offer_panel",
    });

    expect(result.fits).toBe(false);
    expect(result.repairCodes).toContain("SHORTEN_HEADLINE");
  });
});
