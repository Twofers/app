import { describe, expect, it } from "vitest";

import { validateDealEligibility, type DealEligibilityInput } from "../../deal-eligibility";
import { buildOfferDefinitionV1 } from "../../offer-definition";
import {
  buildPosterCopyFromOfferDefinition,
  buildPosterOfferLinesFromOfferDefinition,
  buildPosterSpecFromOfferDefinition,
  checkMerchantPosterHeadline,
  checkMerchantPosterSubline,
  normalizePosterSpecForPublish,
  sanitizePosterBusinessName,
} from "../posterCopy";
import { validatePosterSpecV1 } from "../posterAdSpec";
import {
  assertPosterCopyPolicy,
  checkPosterTextFit,
  clampPosterText,
  POSTER_TEXT_LIMITS,
  sanitizePosterCopy,
  sanitizePosterText,
} from "../posterPolicy";
import type { PosterCopyV1 } from "../posterTypes";

function definitionFor(input: DealEligibilityInput) {
  const eligibilityResult = validateDealEligibility(input);
  const definition = buildOfferDefinitionV1({
    businessId: "biz_123",
    businessName: "Merit Twofer Coffee",
    locationId: "loc_123",
    locationName: "Merit Coffee",
    dealEligibility: input,
    eligibilityResult,
    quantityLimit: 5,
    redemptionLimit: "Claims close 15 minutes before the deal ends.",
  });
  if (!definition) throw new Error("expected valid offer definition");
  return definition;
}

function safeCopy(overrides: Partial<PosterCopyV1> = {}): PosterCopyV1 {
  return {
    business_name: "Merit Coffee",
    headline: "AFTERNOON PICK ME UP",
    offer_line_1: "BUY 1 LATTE",
    offer_line_2: "GET 1 FREE",
    ...overrides,
  };
}

describe("poster policy", () => {
  it("rejects Twofer in poster copy", () => {
    expect(assertPosterCopyPolicy(safeCopy({ headline: "Twofer latte deal" }))).toMatchObject({
      passed: false,
      reasonCodes: expect.arrayContaining(["APP_BRAND_TOKEN"]),
    });
  });

  it("rejects app CTAs and mutable scarcity", () => {
    expect(assertPosterCopyPolicy(safeCopy({ headline: "Claim on Twofer" })).reasonCodes).toEqual(
      expect.arrayContaining(["CTA_CLAIM", "APP_BRAND_TOKEN"]),
    );
    expect(assertPosterCopyPolicy(safeCopy({ subline: "Only 5 available" })).reasonCodes).toContain(
      "SCARCITY_ONLY",
    );
    expect(assertPosterCopyPolicy(safeCopy({ subline: "Redeem now" })).reasonCodes).toContain("CTA_REDEEM");
  });

  it("preserves a real business name after removing only the app token", () => {
    expect(sanitizePosterBusinessName("Twofer Coffee House Dallas", "Cafe")).toBe("Coffee House Dallas");
  });

  it("does not truncate DEAL to DEA", () => {
    expect(clampPosterText("DEAL", 3)).toBe("DEAL");
    expect(sanitizePosterText("DEAL", { maxChars: 3 })).toBe("DEAL");
  });

  it("builds same-item BOGO poster lines", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "latte",
      freeItemQuantity: 1,
      freeItemDescription: "latte",
      freeItemDiscountPercent: 100,
    });

    expect(buildPosterOfferLinesFromOfferDefinition(definition)).toEqual({
      offer_line_1: "2 FOR 1",
      offer_line_2: "LATTE",
    });
  });

  it("builds different-item reward poster lines", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Bacon and egg sandwich",
      freeItemQuantity: 1,
      freeItemDescription: "coffee",
      freeItemDiscountPercent: 100,
    });

    expect(buildPosterOfferLinesFromOfferDefinition(definition)).toEqual({
      offer_line_1: "FREE COFFEE",
      offer_line_2: "WITH BACON AND EGG SANDWICH",
    });
  });

  it("builds percent-off poster lines", () => {
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "blueberry muffin",
    });

    expect(buildPosterOfferLinesFromOfferDefinition(definition)).toEqual({
      offer_line_1: "40% OFF",
      offer_line_2: "BLUEBERRY MUFFIN",
    });
  });

  it("builds sanitized poster copy from authoritative offer facts", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_ONE_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "latte",
      freeItemQuantity: 1,
      freeItemDescription: "latte",
      freeItemDiscountPercent: 100,
    });

    const copy = buildPosterCopyFromOfferDefinition({
      definition,
      headline: "Claim this Twofer now",
      subline: "Only 5 available",
      businessCategory: "Cafe",
    });

    expect(copy.business_name).toBe("Merit Coffee");
    expect(assertPosterCopyPolicy(copy).passed).toBe(true);
    expect(copy.headline).not.toMatch(/claim|twofer/i);
    expect(copy.subline).toBeUndefined();
  });

  it("uses a poster concept when generated copy repeats offer mechanics", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Bacon and egg sandwich",
      freeItemQuantity: 1,
      freeItemDescription: "coffee",
      freeItemDiscountPercent: 100,
    });

    const copy = buildPosterCopyFromOfferDefinition({
      definition,
      headline: "Buy a bacon and egg sandwich and get a free coffee",
      businessCategory: "Cafe",
    });

    expect(copy.business_name).toBe("Merit Coffee");
    expect(copy.headline).toBe("SANDWICH + COFFEE BREAK");
    expect(copy.offer_line_1).toBe("FREE COFFEE");
    expect(copy.offer_line_2).toBe("WITH BACON AND EGG SANDWICH");
  });

  it("allows a product name to become the poster hero", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Any large coffee drink",
      freeItemQuantity: 1,
      freeItemDescription: "Cookie of your choice",
      freeItemDiscountPercent: 100,
    });

    const copy = buildPosterCopyFromOfferDefinition({
      definition,
      headline: "Any large coffee drink",
      businessCategory: "Cafe",
    });

    expect(copy.headline).toBe("ANY LARGE COFFEE DRINK");
    expect(copy.offer_line_1).toBe("FREE COOKIE OF YOUR CHOICE");
    expect(copy.offer_line_2).toBe("WITH ANY LARGE COFFEE DRINK");
  });

  it("does not let Try our become the poster hero", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Any large coffee drink",
      freeItemQuantity: 1,
      freeItemDescription: "Cookie of your choice",
      freeItemDiscountPercent: 100,
    });

    const copy = buildPosterCopyFromOfferDefinition({
      definition,
      headline: "Try our cookie and coffee deal",
      businessCategory: "Cafe",
    });

    expect(copy.headline).toBe("COFFEE + COOKIE BREAK");
    expect(copy.offer_line_1).toBe("FREE COOKIE OF YOUR CHOICE");
    expect(copy.offer_line_2).toBe("WITH ANY LARGE COFFEE DRINK");
  });

  it("keeps the head noun of a connector-joined item name", () => {
    // R6: posterItemLabel keeps only the last two meaningful words, so
    // "Haircut and fade" reduced to "and fade" and reached a live poster as the
    // headline "AND FADE FOR LESS" — a fragment on a paid ad. Connectors are now
    // dropped before the slice so the head noun survives.
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "Haircut and fade",
    });

    const copy = buildPosterCopyFromOfferDefinition({
      definition,
      headline: "Haircut and fade 40% off",
      businessCategory: "Barber shop",
    });

    expect(copy.headline).not.toMatch(/^(?:and|or|but|plus)\b/i);
    expect(copy.headline).toContain("HAIRCUT");
  });

  it("does not let percent-off mechanics become the poster hero", () => {
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 50,
      itemDescription: "Large iced americano",
    });

    const copy = buildPosterCopyFromOfferDefinition({
      definition,
      headline: "Large iced americano 50% off",
      businessCategory: "Cafe",
    });

    // The rule under test is that the discount must not become the headline — the
    // offer block renders it. The deterministic fallback used to say "<ITEM>
    // SAVINGS", which honoured that rule but read as filler and is exactly the
    // shape POSTER_HEADLINE_FORMULAIC_VALUE now rejects in AI copy; the fallback
    // must not emit copy the gate would refuse.
    expect(copy.headline).toBe("AMERICANO FOR LESS");
    expect(copy.headline).not.toMatch(/\b(?:savings|deal|special|offer)s?$/i);
    expect(copy.offer_line_1).toBe("50% OFF");
    expect(copy.offer_line_2).toBe("LARGE ICED AMERICANO");
  });

  it("allows the exact item name as the poster hero", () => {
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 50,
      itemDescription: "Large iced americano",
    });

    const copy = buildPosterCopyFromOfferDefinition({
      definition,
      headline: "Large iced americano",
      businessCategory: "Cafe",
    });

    expect(copy.headline).toBe("LARGE ICED AMERICANO");
    expect(copy.offer_line_1).toBe("50% OFF");
    expect(copy.offer_line_2).toBe("LARGE ICED AMERICANO");
  });

  it("normalizes publish poster specs to English copy for hosted validator compatibility", () => {
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 50,
      itemDescription: "Large americano",
    });

    const spec = buildPosterSpecFromOfferDefinition({
      definition,
      enabled: true,
      templateId: "premium",
      sourceAssetPath: "biz_123/ai_ad_generated.png",
      renderedAssetPath: null,
      headline: "Large americano",
      businessCategory: "Cafe",
    });
    const publishSpec = normalizePosterSpecForPublish(spec);

    expect(Object.keys(spec.copy_by_language)).toEqual(["en-US", "es-US", "ko-KR"]);
    expect(Object.keys(publishSpec.copy_by_language)).toEqual(["en-US"]);
    expect(validatePosterSpecV1(publishSpec, { offerDefinition: definition, businessId: "biz_123" })).toEqual({
      valid: true,
      reasonCodes: [],
    });
  });

  it("localizes poster badge and context lines from offer facts", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "bagel",
      freeItemQuantity: 1,
      freeItemDescription: "coffee",
      freeItemDiscountPercent: 100,
    });

    expect(buildPosterOfferLinesFromOfferDefinition(definition, "es-US")).toEqual({
      offer_line_1: "CAF\u00C9 GRATIS",
      offer_line_2: "AL COMPRAR 1 BAGEL",
    });
    expect(buildPosterOfferLinesFromOfferDefinition(definition, "ko-KR")).toEqual({
      offer_line_1: "\uCEE4\uD53C \uBB34\uB8CC",
      offer_line_2: "\uBCA0\uC774\uAE00 X 1 \uAD6C\uB9E4 \uC2DC",
    });
  });
});

describe("poster text fit", () => {
  it("shares one set of fit limits across layers", () => {
    expect(POSTER_TEXT_LIMITS).toEqual({ businessName: 34, headline: 28, subline: 32 });
  });

  it("flags over-limit text instead of silently shortening it", () => {
    const fit = checkPosterTextFit("FRESH PASTRIES BAKED EVERY SINGLE MORNING", POSTER_TEXT_LIMITS.subline);
    expect(fit.ok).toBe(false);
    expect(fit.reasonCodes).toContain("POSTER_TEXT_OVER_LIMIT");
    expect(fit.length).toBeGreaterThan(fit.maxChars);
  });

  it("accepts fitting, policy-clean text unchanged", () => {
    expect(checkPosterTextFit("BAKED FRESH DAILY", POSTER_TEXT_LIMITS.subline)).toMatchObject({
      ok: true,
      reasonCodes: [],
    });
  });

  it("flags forbidden terms without rewriting them", () => {
    const fit = checkPosterTextFit("Scan to claim yours", POSTER_TEXT_LIMITS.subline);
    expect(fit.ok).toBe(false);
    expect(fit.reasonCodes).toEqual(expect.arrayContaining(["CTA_SCAN", "CTA_CLAIM"]));
  });

  it("records a warning whenever sanitizing changed the requested copy", () => {
    const clipped = sanitizePosterCopy(
      safeCopy({
        headline: "A very long headline that cannot possibly fit the poster",
        subline: "FRESH PASTRIES BAKED EVERY SINGLE MORNING",
      }),
      "Merit Coffee",
    );
    expect(clipped.copy.headline.length).toBeLessThanOrEqual(POSTER_TEXT_LIMITS.headline);
    expect(clipped.policy.warnings).toEqual(
      expect.arrayContaining(["HEADLINE_TEXT_ADJUSTED", "SUBLINE_TEXT_ADJUSTED"]),
    );

    const untouched = sanitizePosterCopy(safeCopy({ subline: "BAKED FRESH DAILY" }), "Merit Coffee");
    expect(untouched.policy.warnings).toEqual([]);
  });

  it("blocks merchant poster headlines that would be silently replaced", () => {
    expect(checkMerchantPosterHeadline("Buy one get one free latte").reasonCodes).toContain(
      "POSTER_HEADLINE_MECHANICAL",
    );
    expect(checkMerchantPosterHeadline("Try our seasonal latte").reasonCodes).toContain(
      "POSTER_HEADLINE_WEAK_OPENER",
    );
    expect(
      checkMerchantPosterHeadline("A very long headline that cannot possibly fit").reasonCodes,
    ).toContain("POSTER_TEXT_OVER_LIMIT");
    expect(checkMerchantPosterHeadline("Afternoon pick me up")).toMatchObject({ ok: true });
    expect(checkMerchantPosterHeadline("")).toMatchObject({ ok: true });
  });

  it("checks merchant poster sublines for fit and policy only", () => {
    expect(checkMerchantPosterSubline("Baked fresh daily")).toMatchObject({ ok: true });
    expect(checkMerchantPosterSubline("Hurry, only 3 left today").ok).toBe(false);
    expect(
      checkMerchantPosterSubline("A supporting line that is far too long for the poster").reasonCodes,
    ).toContain("POSTER_TEXT_OVER_LIMIT");
  });
});
