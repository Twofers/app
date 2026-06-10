import { describe, expect, it } from "vitest";

import { adToDealDraft, type GeneratedAd } from "./ad-variants";

describe("adToDealDraft", () => {
  it("uses structured short description and terms summary when present", () => {
    const ad: GeneratedAd = {
      headline: "Midday Latte BOGO",
      subheadline: "Legacy subheadline",
      short_description: "Buy one iced vanilla latte and get a muffin free until 1:00.",
      push_notification: "BOGO latte plus muffin until 1:00",
      terms_summary: "Buy one iced vanilla latte, get one blueberry muffin free. 20 available.",
      cta: "Claim deal",
    };

    expect(adToDealDraft(ad, "rough owner note")).toEqual({
      title: "Midday Latte BOGO",
      promo_line: "Buy one iced vanilla latte and get a muffin free until 1:00.",
      cta_text: "Claim deal",
      offer_details: "Buy one iced vanilla latte, get one blueberry muffin free. 20 available.",
    });
  });

  it("keeps legacy subheadline behavior for older generated ads", () => {
    const legacyAd: GeneratedAd = {
      headline: "BOGO Cold Brew",
      subheadline: "Buy one cold brew, get one free.",
      cta: "Claim deal",
    };

    expect(adToDealDraft(legacyAd, "")).toEqual({
      title: "BOGO Cold Brew",
      promo_line: "Buy one cold brew, get one free.",
      cta_text: "Claim deal",
      offer_details: "Buy one cold brew, get one free.\n\nClaim deal",
    });
  });
});
