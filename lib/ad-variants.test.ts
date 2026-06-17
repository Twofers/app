import { describe, expect, it } from "vitest";

import { adToDealDraft, buildFallbackTemplateAd, normalizeGeneratedAdDisplayCopy, type GeneratedAd } from "./ad-variants";

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
      title: "Buy one midday latte, get one free",
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
      title: "Buy one cold brew, get one free",
      promo_line: "Buy one cold brew, get one free.",
      cta_text: "Claim deal",
      offer_details: "Buy one cold brew, get one free.\n\nClaim deal",
    });
  });
});

describe("normalizeGeneratedAdDisplayCopy", () => {
  it("cleans generated headlines and mechanical push text", () => {
    const ad = normalizeGeneratedAdDisplayCopy({
      headline: "BOGO Cold Brew",
      subheadline: "Buy one cold brew, get one free.",
      push_notification: "BOGO cold brew until noon",
      cta: "Claim deal",
    });

    expect(ad.headline).toBe("Buy one cold brew, get one free");
    expect(ad.push_notification).toBe("Buy one cold brew, get one free");
  });
});

describe("buildFallbackTemplateAd", () => {
  it("builds deterministic fallback copy from locked offer terms", () => {
    const ad = buildFallbackTemplateAd({
      businessName: "Cedar Bean",
      ownerOfferHint: "BOGO iced latte today",
      lockedOfferLine: "Buy one iced latte, get one iced latte free.",
      lockedTermsLine: "Valid today from 11 AM to 1 PM.",
      scheduleSummary: "Runs today until 1 PM.",
      quantityLimit: 20,
    });

    expect(ad.copy_source).toBe("DETERMINISTIC_FALLBACK");
    expect(ad.photo_source).toBe("fallback_template");
    expect(ad.poster_storage_path).toBeNull();
    expect(ad.locked_offer_line).toBe("Buy one iced latte, get one iced latte free.");
    expect(ad.terms_summary).toContain("20 available");
  });

  it("prefers owner-edited fields when present", () => {
    const ad = buildFallbackTemplateAd({
      businessName: "Cedar Bean",
      title: "Lunch BOGO",
      promoLine: "Buy one sandwich, get one free.",
      ctaText: "Grab it",
      ownerOfferHint: "rough note",
    });

    expect(ad.headline).toBe("Buy one lunch, get one free");
    expect(ad.push_notification).toBe("Buy one lunch, get one free");
    expect(ad.subheadline).toBe("Buy one sandwich, get one free.");
    expect(ad.cta).toBe("Grab it");
  });
});
