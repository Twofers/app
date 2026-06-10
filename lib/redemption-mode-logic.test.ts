import { describe, expect, it } from "vitest";
import { isRedeemerSessionLike, normalizeRedemptionCode } from "./redemption-mode-logic";

describe("redemption mode logic", () => {
  it("normalizes manual redemption codes", () => {
    expect(normalizeRedemptionCode(" ab-12 c ")).toBe("AB12C");
    expect(normalizeRedemptionCode("a_b.c")).toBe("ABC");
  });

  it("recognizes only restricted redeemer sessions", () => {
    expect(isRedeemerSessionLike({ user: { app_metadata: { app_role: "redeemer" } } })).toBe(true);
    expect(isRedeemerSessionLike({ user: { app_metadata: { app_role: "business" } } })).toBe(false);
    expect(isRedeemerSessionLike(null)).toBe(false);
  });
});
