import { describe, expect, it } from "vitest";
import {
  STRONG_DEAL_ONLY_MESSAGE,
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
});
