import { describe, expect, it } from "vitest";
import { STRONG_DEAL_ONLY_MESSAGE, validateStrongDealOnly } from "./strong-deal-guard";

describe("validateStrongDealOnly", () => {
  // ── Existing passing cases ────────────────────────────────────────────────
  it("accepts explicit BOGO language", () => {
    expect(
      validateStrongDealOnly({ title: "BOGO croissants all afternoon", description: "Buy one get one on any pastry." }),
    ).toEqual({ ok: true });
  });

  it("rejects unclear value language", () => {
    expect(
      validateStrongDealOnly({ title: "Fresh coffee special", description: "Great quality and vibes." }),
    ).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("rejects percentages below 40", () => {
    expect(
      validateStrongDealOnly({ title: "35% off coffee", description: "Limited time only" }),
    ).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  // ── Free-item cases (Rule 1 — always PASS) ────────────────────────────────
  it("accepts 'buy a coffee get a free muffin'", () => {
    expect(
      validateStrongDealOnly({ title: "Buy a coffee, get a free muffin" }),
    ).toEqual({ ok: true });
  });

  it("accepts 'get one free'", () => {
    expect(
      validateStrongDealOnly({ title: "Latte + cookie — get one free" }),
    ).toEqual({ ok: true });
  });

  it("accepts 'free muffin with coffee'", () => {
    expect(
      validateStrongDealOnly({ title: "Free muffin with any coffee purchase" }),
    ).toEqual({ ok: true });
  });

  it("accepts 'on the house'", () => {
    expect(
      validateStrongDealOnly({ title: "Second latte on the house today" }),
    ).toEqual({ ok: true });
  });

  it("accepts 'complimentary'", () => {
    expect(
      validateStrongDealOnly({ title: "Complimentary pastry with your espresso" }),
    ).toEqual({ ok: true });
  });

  it("accepts 'buy one get one free' (spelled out)", () => {
    expect(
      validateStrongDealOnly({ title: "Buy one get one free on all pastries" }),
    ).toEqual({ ok: true });
  });

  it("accepts free item in description even if title is plain", () => {
    expect(
      validateStrongDealOnly({
        title: "Coffee and muffin deal",
        description: "Buy a coffee, get a muffin free.",
      }),
    ).toEqual({ ok: true });
  });

  // ── "sugar-free" should NOT trigger the free-item pass ───────────────────
  it("does NOT accept 'sugar-free latte' alone as a deal", () => {
    expect(
      validateStrongDealOnly({ title: "Sugar-free latte special" }),
    ).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("does NOT accept 'dairy-free option available' alone", () => {
    expect(
      validateStrongDealOnly({ title: "Dairy-free option available today" }),
    ).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  // ── Conditional discount (Rule 2 — always REJECT) ────────────────────────
  it("rejects 'buy a coffee + 40% off muffin'", () => {
    expect(
      validateStrongDealOnly({ title: "Buy a coffee + 40% off muffin" }),
    ).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("rejects 'buy a latte + 50% off pastry'", () => {
    expect(
      validateStrongDealOnly({ title: "Buy a latte + 50% off any pastry" }),
    ).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("rejects 'buy espresso + 60% off second drink'", () => {
    expect(
      validateStrongDealOnly({ title: "Buy an espresso + 60% off second drink" }),
    ).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  // ── Strong-language cases (Rule 4 — PASS) ────────────────────────────────
  it("accepts 2-for-1", () => {
    expect(
      validateStrongDealOnly({ title: "2-for-1 oat milk lattes" }),
    ).toEqual({ ok: true });
  });

  it("accepts 40% off", () => {
    expect(
      validateStrongDealOnly({ title: "40% off all drinks today" }),
    ).toEqual({ ok: true });
  });

  it("accepts 50% off", () => {
    expect(
      validateStrongDealOnly({ title: "50% off second item" }),
    ).toEqual({ ok: true });
  });

  // ── Misspelling tolerance (AI handles this, but guard should still work) ──
  it("accepts BOGO with typo in description (AI-generated output)", () => {
    // After AI rewrites "cofee + muffin" it outputs proper BOGO copy
    expect(
      validateStrongDealOnly({
        title: "Buy a coffee, get a free muffin",
        description: "Grab a latte and we'll throw in a muffin for free.",
      }),
    ).toEqual({ ok: true });
  });
});
