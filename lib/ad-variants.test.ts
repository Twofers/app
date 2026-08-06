import { describe, expect, it } from "vitest";

import {
  adToDealDraft,
  buildFallbackTemplateAd,
  buildOfferDefinitionFallbackAd,
  composeListingDescription,
  normalizeGeneratedAdDisplayCopy,
  appendRevisionFeedback,
  revisionFeedbackContainsSuggestion,
  revisionPresetForSuggestion,
  copyFingerprint,
  copyFingerprintHash,
  shortHash,
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

    // F-010: the promo line already states the offer, so the canonical offer line
    // is dropped from offer_details (kept only the precise terms).
    expect(draft.offer_details).not.toContain("Buy a large coffee drink and get a free cookie of your choice");
    expect(draft.offer_details).toContain("Redeem only at 123 Dev Smoke St.");
    expect(draft.offer_details).toContain("Limited to 50 available.");
    expect(draft.offer_details).toContain("Limit one claim per customer.");
    expect(draft.offer_details).not.toContain("Offer window:");
    expect(draft.offer_details).not.toContain("Claims close");
    expect(draft.offer_details).not.toContain("Schedule:");
    expect(draft.offer_details).not.toContain("Max claims:");
    expect(draft.offer_details).not.toContain("5:47:46 PM");
  });

  it("drops the offer line from details when a promo line already carries it (F-010)", () => {
    const ad: GeneratedAd = {
      headline: "Get 40% off one large ice tea",
      subheadline: "Save 40% on one large ice tea.",
      short_description: "Save 40% on one large ice tea.",
      cta: "Claim deal",
      locked_offer_line: "Get 40% off one large ice tea",
      locked_terms_line:
        "Get 40% off one large ice tea. Redeem only at 9460 N MacArthur Blvd, Irving, TX 75063, USA. Limited to 50 available.",
    };

    // Previously offer_details led with the offer line, which then stacked onto the
    // promo line in composeListingDescription and repeated the offer. Now only the
    // precise terms remain.
    expect(adToDealDraft(ad, "").offer_details).toBe(
      "Redeem only at 9460 N MacArthur Blvd, Irving, TX 75063, USA. Limited to 50 available.",
    );
  });

  it("keeps the offer line when there is no promo line to carry it", () => {
    const ad: GeneratedAd = {
      headline: "Get 40% off one large ice tea",
      subheadline: "",
      short_description: "",
      cta: "Claim deal",
      locked_offer_line: "Get 40% off one large ice tea",
      locked_terms_line: "Redeem only at 9460 N MacArthur Blvd. Limited to 50 available.",
    };

    expect(adToDealDraft(ad, "").offer_details).toBe(
      "Get 40% off one large ice tea\nRedeem only at 9460 N MacArthur Blvd. Limited to 50 available.",
    );
  });

  it("stores the offer once, not three times, in the final listing description (F-010)", () => {
    const ad: GeneratedAd = {
      headline: "Coffee + cookie",
      subheadline: "A large coffee drink comes with a free cookie.",
      short_description: "Buy any large coffee drink and get a free cookie of your choice.",
      cta: "Claim deal",
      locked_offer_line: "Buy any large coffee drink and get a free cookie of your choice",
      locked_terms_line:
        "Purchase any large coffee drink to receive one free cookie. Redeem only at 12 Test St. Limited to 25 available.",
    };

    const draft = adToDealDraft(ad, "");
    const stored = composeListingDescription(draft.promo_line, "", draft.offer_details);

    // The offer headline phrase appears once (the promo line), and the precise
    // restatement appears once (the terms line) — not the old promo+offer+terms 3×.
    expect(stored.match(/get a free cookie of your choice/gi)?.length ?? 0).toBe(1);
    expect(stored).toContain("Purchase any large coffee drink to receive one free cookie.");
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

  it("trims copy alternative review metadata", () => {
    const ad = normalizeGeneratedAdDisplayCopy({
      headline: "Coffee + cookie",
      subheadline: "Buy coffee and get a cookie.",
      cta: "Claim deal",
      copy_alternatives: [
        {
          candidate_id: "candidate_1",
          strategy_id: " value_clarity ",
          strategy_reason: "  Leads with the coffee-cookie value.  ",
          headline: " Coffee + cookie ",
          short_description: " Buy coffee and get a cookie. ",
        },
      ],
    });

    expect(ad.copy_alternatives?.[0]).toMatchObject({
      strategy_id: "value_clarity",
      strategy_reason: "Leads with the coffee-cookie value.",
      short_description: "Buy coffee and get a cookie.",
    });
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

describe("composeListingDescription whitespace", () => {
  it("collapses doubled spaces left behind by merchant edits", () => {
    // Deleting the item name from "Save 40% on one THE RECON ROAST espresso."
    // leaves the gap this collapses.
    expect(composeListingDescription("Save 40% on one  espresso.", "", "")).toBe(
      "Save 40% on one espresso.",
    );
    expect(composeListingDescription("Save 40%\ton one\t\tespresso.", "", "")).toBe(
      "Save 40% on one espresso.",
    );
  });

  it("keeps the merchant's own line breaks in the offer details", () => {
    expect(composeListingDescription("Promo line", "", "Redeem only at 12 Test St.\nLimited to 25 available.")).toBe(
      "Promo line\n\nRedeem only at 12 Test St.\nLimited to 25 available.",
    );
  });

  it("drops trailing spaces at the end of a line without joining the lines", () => {
    expect(composeListingDescription("", "", "First line.   \nSecond line.")).toBe(
      "First line.\nSecond line.",
    );
  });

  it("still drops parts that are empty or whitespace only", () => {
    expect(composeListingDescription("Promo", "   ", "Details")).toBe("Promo\n\nDetails");
  });
});

describe("appendRevisionFeedback", () => {
  it("appends new text onto existing feedback with a separator", () => {
    expect(appendRevisionFeedback("Make it shorter.", "Warmer tone please")).toBe(
      "Make it shorter. Warmer tone please",
    );
  });

  it("does not add a second period when the current text already ends one", () => {
    expect(appendRevisionFeedback("Make it shorter.", "Warmer")).toBe("Make it shorter. Warmer");
    expect(appendRevisionFeedback("Make it shorter", "Warmer")).toBe("Make it shorter. Warmer");
  });

  it("skips the append when the addition is already present, case-insensitively", () => {
    expect(appendRevisionFeedback("Please make it WARMER and shorter", "warmer")).toBe(
      "Please make it WARMER and shorter",
    );
  });

  it("returns the addition alone when there is no existing feedback", () => {
    expect(appendRevisionFeedback("", "  Make it shorter.  ")).toBe("Make it shorter.");
    expect(appendRevisionFeedback("   ", "New image angle")).toBe("New image angle");
  });

  it("returns the trimmed current text when the addition is empty", () => {
    expect(appendRevisionFeedback("Existing feedback", "   ")).toBe("Existing feedback");
  });

  it("caps the combined result at the max length without slicing a word in half", () => {
    const current = "a".repeat(750);
    const addition = "b".repeat(100);
    const result = appendRevisionFeedback(current, addition);
    // Combined (before capping) is 750 a's + ". " + 100 b's = 852 chars. A
    // hard slice(0, 800) would land 48 characters into the "b" run — a
    // truncated word. The fix drops that whole half-cut trailing word (and
    // the now-orphaned separator) instead of keeping the fragment.
    expect(result.length).toBeLessThanOrEqual(800);
    expect(result).toBe("a".repeat(750));
  });

  it("keeps whole words and never cuts one in half at the cap", () => {
    const current = "x".repeat(795);
    const addition = "hello world";
    const result = appendRevisionFeedback(current, addition, 800);
    // Combined is 795 x's + ". " + "hello world" = 808 chars. Slicing at 800
    // would land inside "hello" ("...hel"). No whole word from the addition
    // fits after the separator, so the cut backs all the way up to the x run
    // and drops the orphaned trailing separator too.
    expect(result.length).toBeLessThanOrEqual(800);
    expect(result).toBe("x".repeat(795));
    expect(result).not.toMatch(/\s$/);
  });

  it("keeps as many whole words as fit before the cap, dropping only the partial one", () => {
    const current = "Please rewrite the top headline";
    const addition = "so it sounds like a real local ad written by a person, not a template";
    const maxLength = current.length + 2 + 20; // room for ". " + a few whole words only
    const result = appendRevisionFeedback(current, addition, maxLength);
    const uncapped = `${current}. ${addition}`;
    expect(result.length).toBeLessThanOrEqual(maxLength);
    // Whatever survived the cut must be an exact prefix of the untruncated
    // text (modulo the trailing separator/punctuation stripped at the cut
    // point) — i.e. no word was sliced mid-way.
    expect(uncapped.startsWith(result)).toBe(true);
    expect(result).not.toMatch(/\s$/);
    const nextChar = uncapped[result.length];
    expect(nextChar === undefined || /\s/.test(nextChar) || /[.,;:!?-]/.test(nextChar)).toBe(true);
  });
});

describe("revisionFeedbackContainsSuggestion", () => {
  it("matches case-insensitively, consistent with appendRevisionFeedback's dedup", () => {
    expect(revisionFeedbackContainsSuggestion("Please make it WARMER and shorter", "warmer")).toBe(true);
    expect(revisionFeedbackContainsSuggestion("Make it shorter.", "Warmer")).toBe(false);
  });

  it("matches on substring containment, not exact equality", () => {
    // A chip's canned text survives inside a longer, appended feedback string
    // (this is exactly what keeps a chip's "selected" highlight lit after
    // appendRevisionFeedback joins it onto existing text).
    const feedback = appendRevisionFeedback("Make it shorter.", "Warmer tone please");
    expect(revisionFeedbackContainsSuggestion(feedback, "Warmer tone please")).toBe(true);
  });

  it("unselects once the suggestion text is edited out", () => {
    expect(revisionFeedbackContainsSuggestion("Make it shorter and warm", "Warmer tone please")).toBe(false);
  });
});

describe("revisionPresetForSuggestion", () => {
  it("maps each known revision suggestion chip to a stable preset key", () => {
    expect(revisionPresetForSuggestion("new_image")).toBe("revisePresetTryAnotherImage");
    expect(revisionPresetForSuggestion("top_headline")).toBe("revisePresetCopyTopHeadline");
    expect(revisionPresetForSuggestion("shorter")).toBe("revisePresetCopyShorter");
    expect(revisionPresetForSuggestion("warmer")).toBe("revisePresetCopyWarmer");
  });

  it("returns undefined for an unknown key instead of guessing", () => {
    expect(revisionPresetForSuggestion("not_a_real_chip")).toBeUndefined();
  });

  it("the image preset key lowercases into the exact substring the server regex matches", () => {
    // supabase/functions/ai-generate-ad-variants/index.ts's imageRevisionInstruction
    // does `text.includes("revisepresettryanotherimage")` against the lowercased
    // concatenation of revision_preset + revision_feedback.
    expect(revisionPresetForSuggestion("new_image")!.toLowerCase()).toBe("revisepresettryanotherimage");
  });
});

describe("copyFingerprint / copyFingerprintHash", () => {
  const baseAd: GeneratedAd = {
    headline: "Buy one latte, get one free",
    subheadline: "Legacy subheadline",
    short_description: "Buy one iced latte and get a second free.",
    cta: "Claim deal",
  };

  it("changes when any visible copy field changes", () => {
    const changed: GeneratedAd = { ...baseAd, headline: "Different headline entirely" };
    expect(copyFingerprint(changed)).not.toBe(copyFingerprint(baseAd));
    expect(copyFingerprintHash(changed)).not.toBe(copyFingerprintHash(baseAd));
  });

  it("stays the same when only whitespace or casing differs", () => {
    const reformatted: GeneratedAd = { ...baseAd, headline: "  BUY ONE LATTE, GET ONE   FREE  " };
    expect(copyFingerprint(reformatted)).toBe(copyFingerprint(baseAd));
    expect(copyFingerprintHash(reformatted)).toBe(copyFingerprintHash(baseAd));
  });

  it("stays the same when only image fields differ (copy-only revision keeps the same copy fingerprint)", () => {
    const sameCopyNewImage: GeneratedAd = {
      ...baseAd,
      poster_storage_path: "deal-photos/new-path.jpg",
      photo_source: "generated",
    };
    expect(copyFingerprint(sameCopyNewImage)).toBe(copyFingerprint(baseAd));
  });

  it("is deterministic for the same input", () => {
    expect(copyFingerprintHash(baseAd)).toBe(copyFingerprintHash({ ...baseAd }));
  });
});

describe("shortHash", () => {
  it("is deterministic", () => {
    expect(shortHash("abc")).toBe(shortHash("abc"));
  });

  it("differs for different inputs", () => {
    expect(shortHash("abc")).not.toBe(shortHash("abd"));
  });

  it("returns a non-empty string for empty input", () => {
    expect(shortHash("")).toBe("0");
  });
});
