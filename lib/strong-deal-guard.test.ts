import { describe, expect, it } from "vitest";
import {
  STRONG_DEAL_ONLY_MESSAGE,
  structuredOfferIsStrong,
  validateMenuOfferCanonicalSummary,
  validateStrongDealOnly,
} from "./strong-deal-guard";

describe("validateStrongDealOnly", () => {
  it("accepts explicit BOGO language", () => {
    expect(
      validateStrongDealOnly({
        title: "BOGO croissants all afternoon",
        description: "Buy one get one on any pastry.",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects unclear value language", () => {
    expect(
      validateStrongDealOnly({ title: "Fresh coffee special", description: "Great quality and vibes." }),
    ).toEqual({ ok: false, reason: "no_strong_language", message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("rejects percentages below 40", () => {
    expect(
      validateStrongDealOnly({ title: "35% off coffee", description: "Limited time only" }),
    ).toEqual({ ok: false, reason: "low_percent", message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("accepts buy a coffee get a free muffin", () => {
    expect(validateStrongDealOnly({ title: "Buy a coffee, get a free muffin" })).toEqual({ ok: true });
  });

  it("accepts get one free", () => {
    expect(validateStrongDealOnly({ title: "Latte + cookie - get one free" })).toEqual({ ok: true });
  });

  it("accepts free muffin with coffee", () => {
    expect(validateStrongDealOnly({ title: "Free muffin with any coffee purchase" })).toEqual({ ok: true });
  });

  it("accepts on the house", () => {
    expect(validateStrongDealOnly({ title: "Second latte on the house today" })).toEqual({ ok: true });
  });

  it("accepts complimentary", () => {
    expect(validateStrongDealOnly({ title: "Complimentary pastry with your espresso" })).toEqual({ ok: true });
  });

  it("accepts buy one get one free spelled out", () => {
    expect(validateStrongDealOnly({ title: "Buy one get one free on all pastries" })).toEqual({ ok: true });
  });

  it("accepts free item in description even if title is plain", () => {
    expect(
      validateStrongDealOnly({
        title: "Coffee and muffin deal",
        description: "Buy a coffee, get a muffin free.",
      }),
    ).toEqual({ ok: true });
  });

  it("does not accept sugar-free latte alone as a deal", () => {
    expect(validateStrongDealOnly({ title: "Sugar-free latte special" })).toEqual({
      ok: false,
      reason: "no_strong_language",
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });

  it("does not accept dairy-free option alone", () => {
    expect(validateStrongDealOnly({ title: "Dairy-free option available today" })).toEqual({
      ok: false,
      reason: "no_strong_language",
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });

  it("rejects buy a coffee plus 40% off muffin", () => {
    expect(validateStrongDealOnly({ title: "Buy a coffee + 40% off muffin" })).toEqual({
      ok: false,
      reason: "conditional",
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });

  it("rejects buy a latte plus 50% off pastry", () => {
    expect(validateStrongDealOnly({ title: "Buy a latte + 50% off any pastry" })).toEqual({
      ok: false,
      reason: "conditional",
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });

  it("rejects buy espresso plus 60% off second drink", () => {
    expect(validateStrongDealOnly({ title: "Buy an espresso + 60% off second drink" })).toEqual({
      ok: false,
      reason: "second_item_discount",
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });

  it("accepts 2-for-1", () => {
    expect(validateStrongDealOnly({ title: "2-for-1 oat milk lattes" })).toEqual({ ok: true });
  });

  it("rejects broad 40% off entire-category copy", () => {
    expect(validateStrongDealOnly({ title: "40% off all drinks today" })).toEqual({
      ok: false,
      reason: "entire_order",
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });

  it("rejects 40% off an entire order", () => {
    expect(validateStrongDealOnly({ title: "40% off your entire order" })).toEqual({
      ok: false,
      reason: "entire_order",
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });

  it("rejects 50% off a second item", () => {
    expect(validateStrongDealOnly({ title: "50% off second item" })).toEqual({
      ok: false,
      reason: "second_item_discount",
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });

  it("validateMenuOfferCanonicalSummary matches structured wizard lines", () => {
    expect(
      validateMenuOfferCanonicalSummary({
        human_summary: "Buy Latte, get Croissant free.",
      }),
    ).toEqual({ ok: true });
    expect(
      validateMenuOfferCanonicalSummary({
        human_summary: "50% off the second item - Bagel.",
      }),
    ).toEqual({ ok: false, reason: "second_item_discount", message: STRONG_DEAL_ONLY_MESSAGE });
    expect(
      validateMenuOfferCanonicalSummary({
        human_summary: "5% off Latte",
        discount_percent: 5,
      }),
    ).toEqual({ ok: false, reason: "low_percent", message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("accepts BOGO with typo in description from generated output", () => {
    expect(
      validateStrongDealOnly({
        title: "Buy a coffee, get a free muffin",
        description: "Grab a latte and we'll throw in a muffin for free.",
      }),
    ).toEqual({ ok: true });
  });

  // R13. Observed live in the poster-quality harness (session 3, J5): a genuine 40%-off
  // offer was BLOCKED FROM PUBLISHING because the generated copy said "for 40% less"
  // instead of the literal "40% off", and the error told the merchant to fix an offer that
  // was never wrong. Publishing came down to which synonym the model drew.
  describe("R13 — the structured offer outranks the wording", () => {
    const synonyms = [
      "Enjoy your favourite croissant for 40% less this week.",
      "Save 40% on any croissant.",
      "Take 40 percent off a croissant.",
      "Croissants are 40% cheaper today.",
    ];

    it("accepts a valid 40% deal however the copy phrases it", () => {
      for (const description of synonyms) {
        expect(
          validateStrongDealOnly({
            title: "Croissant, 40% less",
            description,
            structuredOffer: { dealType: "PERCENT_OFF_SINGLE_ITEM", discountPercent: 40 },
          }),
          description,
        ).toEqual({ ok: true });
      }
    });

    it("still rejects those same phrasings when the structured offer is absent", () => {
      // Proves the tests above pass because of the contract, not because the prose rules
      // were quietly loosened.
      for (const description of synonyms) {
        expect(validateStrongDealOnly({ title: "Croissant deal", description }).ok, description).toBe(false);
      }
    });

    it("accepts a structured free-item deal with no strong phrase in the copy", () => {
      expect(
        validateStrongDealOnly({
          title: "Afternoon pick-me-up",
          description: "Grab a large coffee and we'll add a cookie of your choice.",
          structuredOffer: {
            dealType: "BUY_ONE_GET_SOMETHING_FREE",
            freeItemQuantity: 1,
            freeItemDiscountPercent: 100,
          },
        }),
      ).toEqual({ ok: true });
    });

    it("does not let the structured offer rescue a weak or disqualified deal", () => {
      // Below the floor.
      expect(
        validateStrongDealOnly({
          title: "10% off a latte",
          description: "Ten percent off.",
          structuredOffer: { dealType: "PERCENT_OFF_SINGLE_ITEM", discountPercent: 10 },
        }),
      ).toEqual({ ok: false, reason: "low_percent", message: STRONG_DEAL_ONLY_MESSAGE });

      // Shape rejections still fire ahead of the structured accept.
      expect(
        validateStrongDealOnly({
          title: "50% off your entire order",
          description: "50% off your entire order.",
          structuredOffer: { dealType: "PERCENT_OFF_SINGLE_ITEM", discountPercent: 50 },
        }),
      ).toEqual({ ok: false, reason: "entire_order", message: STRONG_DEAL_ONLY_MESSAGE });

      expect(
        validateStrongDealOnly({
          title: "Buy one get one 50% off",
          description: "Buy one get one 50% off.",
          structuredOffer: { dealType: "PERCENT_OFF_SINGLE_ITEM", discountPercent: 50 },
        }),
      ).toEqual({ ok: false, reason: "second_item_discount", message: STRONG_DEAL_ONLY_MESSAGE });
    });

    it("falls through to the prose rules when there are no structured facts", () => {
      expect(structuredOfferIsStrong(null)).toBeNull();
      expect(structuredOfferIsStrong({})).toBeNull();
      expect(structuredOfferIsStrong({ dealType: "PERCENT_OFF_SINGLE_ITEM" })).toBeNull();
      expect(structuredOfferIsStrong({ discountPercent: 40 })).toBe(true);
      expect(structuredOfferIsStrong({ discountPercent: 39 })).toBe(false);
      expect(structuredOfferIsStrong({ dealType: "buy_one_get_one_free" })).toBe(true);
    });
  });
});
