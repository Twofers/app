import { describe, expect, it } from "vitest";

import {
  adToDealDraft,
  buildFallbackTemplateAd,
  buildOfferDefinitionFallbackAd,
  normalizeGeneratedAdDisplayCopy,
  type GeneratedAd,
} from "./ad-variants";
import { validateDealEligibility } from "./deal-eligibility";
import { buildOfferDefinitionV1 } from "./offer-definition";

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
      title: "Buy one midday latte and get one free",
      promo_line: "Buy one iced vanilla latte and get a muffin free until 1:00.",
      cta_text: "Claim deal",
      offer_details: "Buy one iced vanilla latte, get one blueberry muffin free. 20 available.",
    });
  });

  it("keeps timing metadata out of accepted draft details because the app renders schedule separately", () => {
    const ad: GeneratedAd = {
      headline: "Large coffee drink + cookie",
      subheadline: "A large coffee drink comes with your cookie pick.",
      short_description: "Buy a large coffee drink and get a free cookie.",
      cta: "Use this ad",
      locked_offer_line: "Buy a large coffee drink and get a free cookie of your choice",
      locked_terms_line:
        "Redeem only at 123 Dev Smoke St. Limited to 50 available. Offer window: One-time: 6/28/2026, 5:47:46 PM \u2192 6/28/2026, 7:47:46 PM. Claims close 15 minutes before the deal ends. Limit one claim per customer. Schedule: One-time: 6/28/2026, 5:47:46 PM \u2192 6/28/2026, 7:47:46 PM. Max claims: 50",
    };

    const draft = adToDealDraft(ad, "");

    expect(draft.offer_details).toContain("Buy a large coffee drink and get a free cookie of your choice");
    expect(draft.offer_details).toContain("Redeem only at 123 Dev Smoke St.");
    expect(draft.offer_details).toContain("Limited to 50 available.");
    expect(draft.offer_details).toContain("Limit one claim per customer.");
    expect(draft.offer_details).not.toContain("Offer window:");
    expect(draft.offer_details).not.toContain("Claims close");
    expect(draft.offer_details).not.toContain("Schedule:");
    expect(draft.offer_details).not.toContain("Max claims:");
    expect(draft.offer_details).not.toContain("5:47:46 PM");
  });

  it("keeps legacy subheadline behavior for older generated ads", () => {
    const legacyAd: GeneratedAd = {
      headline: "BOGO Cold Brew",
      subheadline: "Buy one cold brew, get one free.",
      cta: "Claim deal",
    };

    expect(adToDealDraft(legacyAd, "")).toEqual({
      title: "Buy one cold brew and get one free",
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

    expect(ad.headline).toBe("Buy one cold brew and get one free");
    expect(ad.push_notification).toBe("Buy one cold brew and get one free");
  });

  it("keeps up to five generated copy alternatives", () => {
    const ad = normalizeGeneratedAdDisplayCopy({
      headline: "Coffee + cookie",
      subheadline: "Buy coffee and get a cookie.",
      cta: "Claim deal",
      copy_alternatives: Array.from({ length: 6 }, (_, index) => ({
        candidate_id: `candidate_${index + 1}`,
        strategy_id: "value_clarity",
        headline: `Coffee option ${index + 1}`,
        short_description: `Buy coffee and get a cookie option ${index + 1}.`,
      })),
    });

    expect(ad.copy_alternatives).toHaveLength(5);
    expect(ad.copy_alternatives?.map((option) => option.candidate_id)).toEqual([
      "candidate_1",
      "candidate_2",
      "candidate_3",
      "candidate_4",
      "candidate_5",
    ]);
  });
});

describe("buildFallbackTemplateAd", () => {
  it("builds deterministic fallback copy from locked offer terms", () => {
    const ad = buildFallbackTemplateAd({
      businessName: "Cedar Bean",
      ownerOfferHint: "BOGO iced latte today",
      lockedOfferLine: "Buy one iced latte and get one free",
      lockedTermsLine: "Valid today from 11 AM to 1 PM.",
      scheduleSummary: "Runs today until 1 PM.",
      quantityLimit: 20,
    });

    expect(ad.copy_source).toBe("DETERMINISTIC_FALLBACK");
    expect(ad.photo_source).toBe("fallback_template");
    expect(ad.poster_storage_path).toBeNull();
    expect(ad.locked_offer_line).toBe("Buy one iced latte and get one free");
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

    expect(ad.headline).toBe("Buy one lunch and get one free");
    expect(ad.push_notification).toBe("Buy one lunch and get one free");
    expect(ad.subheadline).toBe("Buy one sandwich, get one free.");
    expect(ad.cta).toBe("Grab it");
  });

  it("builds a safe fallback ad from OfferDefinitionV1", () => {
    const dealEligibility = {
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "bagel",
      freeItemQuantity: 1,
      freeItemDescription: "coffee",
      freeItemDiscountPercent: 100,
    };
    const definition = buildOfferDefinitionV1({
      businessId: "biz_123",
      businessName: "Cedar Bean",
      locationId: "loc_123",
      locationName: "Cedar Bean - Main",
      dealEligibility,
      eligibilityResult: validateDealEligibility(dealEligibility),
      activeWindowHumanReadable: "Today 11:00 AM to 1:00 PM",
      quantityLimit: 12,
      redemptionLimit: "Claims close 15 minutes before the deal ends.",
      schedule: { mode: "summary_only", summary: "Today 11:00 AM to 1:00 PM" },
    });

    if (!definition) throw new Error("expected valid definition");
    const ad = buildOfferDefinitionFallbackAd(definition, { ctaText: "Claim deal" });

    expect(ad.copy_source).toBe("DETERMINISTIC_FALLBACK");
    expect(ad.photo_source).toBe("fallback_template");
    expect(ad.locked_offer_line).toBe("Buy a bagel and get a free coffee");
    expect(ad.locked_terms_line).toContain("Redeem only at Cedar Bean - Main.");
    expect(ad.locked_terms_line).toContain("Limited to 12 available.");
    expect(ad.locked_terms_line).toContain("Claims close 15 minutes before the deal ends.");
    expect(ad.poster_storage_path).toBeNull();
  });
});
