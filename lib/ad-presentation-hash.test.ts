import { describe, expect, it } from "vitest";

import { createAdPresentationHash } from "./ad-presentation-hash";
import { buildDefaultAdPresentationSpec } from "./ad-presentation-spec";
import type { ApprovedAdCopy, ImmutableOfferFacts } from "./ad-render-content";

const offerFacts: ImmutableOfferFacts = {
  primaryOfferLine: "Buy one latte and get one free",
  compactOfferLine: "Buy one latte and get one free",
  termsLine: "Limit one claim per customer.",
  accessibilityOfferDescription: "Buy one latte and get one free. Limit one claim per customer.",
};

const copy: ApprovedAdCopy = {
  headline: "Your coffee break just doubled",
  supportingCopy: "Bring a friend before the window closes.",
  ctaLabel: "Claim deal",
};

describe("ad presentation hash", () => {
  it("is stable for the approved creative and presentation inputs", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
    });

    expect(createAdPresentationHash({ presentation, offerFacts, copy })).toBe(
      createAdPresentationHash({ presentation: { ...presentation }, offerFacts: { ...offerFacts }, copy: { ...copy } }),
    );
  });

  it("changes when material presentation inputs change", () => {
    const base = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
    });
    const changed = { ...base, templateId: "split_offer_panel" as const };

    expect(createAdPresentationHash({ presentation: base, offerFacts, copy })).not.toBe(
      createAdPresentationHash({ presentation: changed, offerFacts, copy }),
    );
  });

  it("does not include live countdown or quantity state", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
    });
    const withSchedule = { ...offerFacts, scheduleSummary: "Ends in 12 minutes", priceLabel: "$4.00" };
    const withoutSchedule = { ...offerFacts, scheduleSummary: "Ends in 1 minute", priceLabel: "$4.00" };

    expect(createAdPresentationHash({ presentation, offerFacts: withSchedule, copy })).toBe(
      createAdPresentationHash({ presentation, offerFacts: withoutSchedule, copy }),
    );
  });
});
