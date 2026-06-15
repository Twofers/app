import { describe, expect, it } from "vitest";
import { isRedeemerSessionLike, isRedemptionCodeComplete, normalizeRedemptionCode } from "./redemption-mode-logic";

describe("redemption mode logic", () => {
  it("normalizes manual redemption codes", () => {
    expect(normalizeRedemptionCode(" ab-12 c ")).toBe("AB12C");
    expect(normalizeRedemptionCode("a_b.c")).toBe("ABC");
    expect(normalizeRedemptionCode(" ab-12-cd-99 ")).toBe("AB12CD");
  });

  it("requires the complete six-character ticket code", () => {
    expect(isRedemptionCodeComplete("ab-12-c")).toBe(false);
    expect(isRedemptionCodeComplete("ab-12-cd")).toBe(true);
  });

  it("recognizes only restricted redeemer sessions", () => {
    expect(isRedeemerSessionLike({ user: { app_metadata: { app_role: "redeemer" } } })).toBe(true);
    expect(isRedeemerSessionLike({ user: { app_metadata: { app_role: "business" } } })).toBe(false);
    expect(isRedeemerSessionLike(null)).toBe(false);
  });
});
