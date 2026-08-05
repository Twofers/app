import { describe, expect, it } from "vitest";
import {
  STRONG_DEAL_ONLY_MESSAGE,
  findWeakDealSignal,
  validateStrongDealOnly,
} from "./strong-deal-guard.ts";

describe("validateStrongDealOnly (unchanged behavior)", () => {
  it("still returns ok for text carrying explicit strong-deal language", () => {
    expect(validateStrongDealOnly({ title: "Buy one get one free" })).toEqual({ ok: true });
    expect(validateStrongDealOnly({ title: "40% off today" })).toEqual({ ok: true });
  });

  it("still rejects text with NO strong-deal language, even when the offer is legitimate", () => {
    // This is the pre-existing !hasStrongLanguage branch: validateStrongDealOnly
    // requires strong vocabulary to be present, so a plain free-item description
    // that never says "free"/"BOGO"/"40% off" etc. in a recognized pattern still
    // fails here. Proves this file's change is additive only — this caller-facing
    // behavior (used by publish-time callers) has not moved.
    const result = validateStrongDealOnly({ title: "Complimentary pastry included with any coffee" });
    expect(result).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("still rejects a second-item discount and a sub-40% figure", () => {
    expect(validateStrongDealOnly({ title: "50% off second pastry" })).toEqual({
      ok: false,
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
    expect(validateStrongDealOnly({ title: "25% off your order" })).toEqual({
      ok: false,
      message: STRONG_DEAL_ONLY_MESSAGE,
    });
  });
});

describe("findWeakDealSignal (additive, positive-signal only)", () => {
  it("returns null for a legitimate free-item offer with no strong-language vocabulary", () => {
    // Unlike validateStrongDealOnly, this must NOT flag the mere absence of strong
    // language — only text that positively describes a weak mechanic.
    expect(findWeakDealSignal("Free pastry with any coffee")).toBeNull();
    expect(findWeakDealSignal("Complimentary pastry included with any coffee")).toBeNull();
  });

  it("returns null for genuine strong-deal language", () => {
    expect(findWeakDealSignal("Buy one get one free")).toBeNull();
    expect(findWeakDealSignal("40% off today")).toBeNull();
  });

  it("returns a reason for a second-item discount", () => {
    expect(findWeakDealSignal("50% off second pastry")).toMatch(/second-item/);
  });

  it("returns a reason for an entire-order discount", () => {
    expect(findWeakDealSignal("40% off your entire order")).toMatch(/entire-order/);
  });

  it("returns a reason for any explicit sub-40% figure", () => {
    expect(findWeakDealSignal("25% off your order")).toMatch(/25% off/);
    expect(findWeakDealSignal("10% off")).toMatch(/10% off/);
  });

  it("returns null for empty or whitespace-only text", () => {
    expect(findWeakDealSignal("")).toBeNull();
    expect(findWeakDealSignal("   ")).toBeNull();
  });
});
