import { describe, expect, it } from "vitest";
import { STRONG_DEAL_ONLY_MESSAGE, validateStrongDealOnly } from "./strong-deal-guard";

describe("validateStrongDealOnly", () => {
  it("accepts explicit BOGO language", () => {
    const out = validateStrongDealOnly({
      title: "BOGO croissants all afternoon",
      description: "Buy one get one on any pastry.",
    });
    expect(out.ok).toBe(true);
  });

  it("rejects unclear value language", () => {
    const out = validateStrongDealOnly({
      title: "Fresh coffee special",
      description: "Great quality and vibes.",
    });
    expect(out).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });

  it("rejects percentages below 40", () => {
    const out = validateStrongDealOnly({
      title: "35% off coffee",
      description: "Limited time only",
    });
    expect(out).toEqual({ ok: false, message: STRONG_DEAL_ONLY_MESSAGE });
  });
});
