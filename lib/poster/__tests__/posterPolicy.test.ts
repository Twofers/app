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
  isGenericPosterKicker,
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

  it("rejects generic merchant poster subheadlines through the shared policy", () => {
    for (const value of [
      "Try our",
      " OUR   DEAL ",
      "special offer",
      "MENU PICK",
      "Oferta especial",
      "추천 메뉴",
    ]) {
      expect(isGenericPosterKicker(value)).toBe(true);
      expect(checkMerchantPosterSubline(value)).toMatchObject({
        ok: false,
        reasonCodes: ["POSTER_SUBLINE_GENERIC_KICKER"],
      });
    }
    expect(isGenericPosterKicker("Baked fresh daily")).toBe(false);
    expect(checkMerchantPosterSubline("Baked fresh daily").ok).toBe(true);
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

  it("keeps the product noun when a long item name will not fit the offer line", () => {
    // R9: offer lines are the poster's FACT channel, but clampPosterText fills from the
    // FRONT, so a head-final item name keeps its modifiers and loses its noun. Observed on
    // a live published poster (Tier-3 J4): "12 ounce bag of whole bean coffee" rendered as
    // "12 OUNCE BAG OF WHOLE" — 21 chars under a 24 limit, naming no product at all.
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "12 ounce bag of whole bean coffee",
    });

    // Guard against a vacuous test: this is what the front-filling clamp alone still
    // produces, and it is exactly the fragment that shipped. If this ever stops holding,
    // the assertions below have stopped proving anything.
    expect(clampPosterText("12 OUNCE BAG OF WHOLE BEAN COFFEE", 24)).toBe("12 OUNCE BAG OF WHOLE");

    const lines = buildPosterOfferLinesFromOfferDefinition(definition);
    expect(lines.offer_line_1).toBe("40% OFF");
    expect(lines.offer_line_2).toBe("BAG OF WHOLE BEAN COFFEE");
    // The invariants that matter: it still names the product, and it still fits.
    expect(lines.offer_line_2.endsWith("COFFEE")).toBe(true);
    expect(lines.offer_line_2.length).toBeLessThanOrEqual(24);
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

  it("keeps identity-bearing modifiers in the fallback headline", () => {
    // R7, cause 1: "cold" was listed as a droppable size modifier, so posterItemLabel
    // reduced "large cold brew" to "brew" and a live poster read "BREW FOR LESS" — at a
    // shop called The Colonel's Brew. Size words are still droppable; temperature and
    // freshness words are not, because they name the product.
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "large cold brew",
    });

    const headline = buildPosterCopyFromOfferDefinition({ definition }).headline;
    expect(headline).toBe("COLD BREW FOR LESS");
    expect(headline).not.toBe("BREW FOR LESS");
    expect(headline.length).toBeLessThanOrEqual(POSTER_TEXT_LIMITS.headline);
  });

  it("keeps the modifiers in front of a known item word while they fit", () => {
    // R7, cause 2: the known-word branch returned the matched word ALONE regardless of
    // budget, so "12 ounce bag of whole bean coffee" became "coffee" — contentless on a
    // poster for a coffee shop. The walk-back stops at "of", which marks the edge of the
    // noun phrase.
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "12 ounce bag of whole bean coffee",
    });

    const headline = buildPosterCopyFromOfferDefinition({ definition }).headline;
    expect(headline).toBe("WHOLE BEAN COFFEE FOR LESS");
    expect(headline).not.toBe("COFFEE FOR LESS");
    expect(headline.length).toBeLessThanOrEqual(POSTER_TEXT_LIMITS.headline);
  });

  it("still drops size words and never reaches past a post-modifier boundary", () => {
    // The two guards that keep R7 from over-reaching. "Any large coffee drink" must not
    // pick up "large"; "Cookie of your choice" is head-FIRST, so the walk-back must stop
    // at "of" rather than dragging in "your choice".
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "Any large coffee drink",
      freeItemQuantity: 1,
      freeItemDescription: "Cookie of your choice",
      freeItemDiscountPercent: 100,
    });

    expect(buildPosterCopyFromOfferDefinition({ definition }).headline).toBe("COFFEE + COOKIE BREAK");
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
    // R7 deliberately changed this expectation from "AMERICANO FOR LESS". The item is
    // "Large iced americano": "Large" is a size word and is still dropped, but "iced"
    // identifies the product and is now kept while it fits. This assertion doubles as the
    // proof that R7's two guards pull in opposite directions correctly.
    expect(copy.headline).toBe("ICED AMERICANO FOR LESS");
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

  it.each(["en-US", "es-US", "ko-KR"] as const)(
    "normalizes publish poster specs to the %s source copy for hosted validator compatibility",
    (sourceLocale) => {
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
      sourceLocale,
      businessCategory: "Cafe",
    });
    const publishSpec = normalizePosterSpecForPublish(spec, sourceLocale);

    expect(Object.keys(spec.copy_by_language)).toEqual(["en-US", "es-US", "ko-KR"]);
    expect(Object.keys(publishSpec.copy_by_language)).toEqual([sourceLocale]);
    expect(publishSpec.copy).toEqual(spec.copy_by_language[sourceLocale]);
    expect(validatePosterSpecV1(publishSpec, { offerDefinition: definition, businessId: "biz_123" })).toEqual({
      valid: true,
      reasonCodes: [],
    });
    },
  );

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

  // Session-4 regression. Spanish and Korean state the offer with a SUFFIX
  // ("<item> GRATIS", "<item> \uBB34\uB8CC"), so clamping the finished line from the front deleted
  // the only word that said anything was free: "galleta de tu elecci\u00F3n GRATIS" is 29
  // characters against a 28 budget and lost GRATIS by one. Found on the live Colonel's Brew
  // cookie deal, which no Spanish shopper could have understood.
  it("keeps the free/discount word when a localized item overruns the offer line", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "any large coffee drink",
      freeItemQuantity: 1,
      freeItemDescription: "cookie of your choice",
      freeItemDiscountPercent: 100,
    });

    const es = buildPosterOfferLinesFromOfferDefinition(definition, "es-US");
    expect(es.offer_line_1).toContain("GRATIS");
    expect(es).toEqual({ offer_line_1: "GALLETA GRATIS", offer_line_2: "AL COMPRAR 1 BEBIDA DE CAF\u00C9" });

    const ko = buildPosterOfferLinesFromOfferDefinition(definition, "ko-KR");
    expect(ko.offer_line_1).toContain("\uBB34\uB8CC");

    // English is head-final and states the offer with a PREFIX, so it must be untouched.
    expect(buildPosterOfferLinesFromOfferDefinition(definition, "en-US")).toEqual({
      offer_line_1: "FREE COOKIE OF YOUR CHOICE",
      offer_line_2: "WITH ANY LARGE COFFEE DRINK",
    });
  });

  // S2. Every non-English poster used to print one sentence twice: copyForLocale set
  // headline := offer_line_2, and nothing deduped, so the hero and the line under it were
  // the same string in two type sizes. Facts are authoritative \u2014 validatePosterSpecV1 binds
  // both offer lines to the deterministic lines for every locale \u2014 so the hero, not an
  // offer line, is the slot that gives way.
  it("never repeats an offer line as the poster hero in any locale", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "any large coffee drink",
      freeItemQuantity: 1,
      freeItemDescription: "cookie of your choice",
      freeItemDiscountPercent: 100,
    });
    const spec = buildPosterSpecFromOfferDefinition({
      definition,
      enabled: true,
      templateId: "premium",
      sourceAssetPath: "biz_123/ai_ad_generated.png",
      renderedAssetPath: null,
      headline: "Coffee + cookie break",
      businessCategory: "Coffee shop",
    });

    for (const locale of ["en-US", "es-US", "ko-KR"] as const) {
      const copy = spec.copy_by_language[locale];
      const rendered = [copy.headline, copy.offer_line_1, copy.offer_line_2].filter(Boolean);
      expect(new Set(rendered).size, `${locale} repeats a line`).toBe(rendered.length);
      // The offer itself must still be stated in full, in every locale.
      expect(copy.offer_line_1).toBeTruthy();
      expect(copy.offer_line_2).toBeTruthy();
    }

    // English keeps its creative hero; the others have none to translate, so they go without
    // rather than duplicating. If a localized headline ever lands, this is what changes.
    expect(spec.copy_by_language["en-US"].headline).toBe("COFFEE + COOKIE BREAK");
    expect(spec.copy_by_language["es-US"].headline).toBe("");
    expect(spec.copy_by_language["ko-KR"].headline).toBe("");

    // An empty hero must not fail the gate \u2014 a missing headline is a warning, not a failure.
    for (const locale of ["es-US", "ko-KR"] as const) {
      expect(assertPosterCopyPolicy(spec.copy_by_language[locale]).passed).toBe(true);
    }
  });

  it("renders merchant poster text only in the deal source language", () => {
    const definition = definitionFor({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: 40,
      itemDescription: "bibimbap",
    });
    const spec = buildPosterSpecFromOfferDefinition({
      definition,
      enabled: true,
      templateId: "premium",
      headline: "오늘의 비빔밥",
      subline: "점심 한정",
      sourceLocale: "ko-KR",
      businessCategory: "Korean restaurant",
    });

    expect(spec.copy_by_language["ko-KR"]).toMatchObject({
      headline: "오늘의 비빔밥",
      subline: "점심 한정",
    });
    expect(spec.copy_by_language["en-US"].headline).toBe("");
    expect(spec.copy_by_language["en-US"].subline).toBeUndefined();
    expect(spec.copy_by_language["es-US"].headline).toBe("");
    expect(spec.copy_by_language["es-US"].subline).toBeUndefined();
  });

  // S4. Poster copy is frozen into offer_versions at publish and never backfilled, so a
  // business that renames leaves every published poster printing the old name. Observed
  // live: a poster reading "Test Cafe" on a screen that said "The Colonel's Brew" three
  // times around it. The canvas prefers the live name; this pins the sanitize behaviour it
  // depends on \u2014 the live name goes through the same clamp and policy scan as a stored one.
  it("sanitizes a substituted live business name the same way as a stored one", () => {
    const stored = safeCopy({ business_name: "Test Cafe" });
    const live = sanitizePosterCopy({ ...stored, business_name: "The Colonel's Brew" }, "The Colonel's Brew").copy;
    expect(live.business_name).toBe("The Colonel's Brew");

    // Over-long live names are clamped, not passed through raw.
    const longName = "A".repeat(POSTER_TEXT_LIMITS.businessName + 12);
    const clamped = sanitizePosterCopy({ ...stored, business_name: longName }, longName).copy;
    expect(clamped.business_name.length).toBeLessThanOrEqual(POSTER_TEXT_LIMITS.businessName);

    // A blank live name must not blank the poster \u2014 the caller falls back to the stored one.
    expect(sanitizePosterCopy(stored, stored.business_name).copy.business_name).toBe("Test Cafe");
  });

  // The mirror of the R9 lesson: a Spanish line must never END on a function word, the way
  // "AL COMPRAR 1 S\u00C1NDWICH DE" did, because Spanish hangs its qualifiers off "de".
  it("never leaves a Spanish offer line dangling on a function word", () => {
    const definition = definitionFor({
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "breakfast sandwich",
      freeItemQuantity: 1,
      freeItemDescription: "hash brown",
      freeItemDiscountPercent: 100,
    });

    const es = buildPosterOfferLinesFromOfferDefinition(definition, "es-US");
    expect(es.offer_line_2).toBe("AL COMPRAR 1 S\u00C1NDWICH");
    for (const line of [es.offer_line_1, es.offer_line_2]) {
      expect(line).not.toMatch(/\s(DE|DEL|CON|Y|A|AL|EN|PARA|TU|SU|LA|EL)$/);
    }
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
