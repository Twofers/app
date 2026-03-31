import { describe, expect, it } from "vitest";

import { selectMonthlyTierPriceId } from "./stripe-price-selection";

describe("selectMonthlyTierPriceId", () => {
  it("chooses exact lookup key match when amount collides", () => {
    const out = selectMonthlyTierPriceId({
      tier: "pro",
      targetCents: 4900,
      prices: [
        { id: "price_other", unit_amount: 4900, recurring: { interval: "month" }, lookup_key: "other_monthly" },
        { id: "price_pro", unit_amount: 4900, recurring: { interval: "month" }, lookup_key: "twofer_pro_monthly" },
      ],
    });
    expect(out).toBe("price_pro");
  });

  it("returns null when same-amount monthly prices are ambiguous", () => {
    const out = selectMonthlyTierPriceId({
      tier: "premium",
      targetCents: 9900,
      prices: [
        { id: "price_a", unit_amount: 9900, recurring: { interval: "month" }, lookup_key: null },
        { id: "price_b", unit_amount: 9900, recurring: { interval: "month" }, lookup_key: null },
      ],
    });
    expect(out).toBeNull();
  });

  it("returns null when expected lookup key has duplicate matches", () => {
    const out = selectMonthlyTierPriceId({
      tier: "pro",
      targetCents: 4900,
      prices: [
        { id: "price_pro_a", unit_amount: 4900, recurring: { interval: "month" }, lookup_key: "twofer_pro_monthly" },
        { id: "price_pro_b", unit_amount: 4900, recurring: { interval: "month" }, lookup_key: "twofer_pro_monthly" },
      ],
    });
    expect(out).toBeNull();
  });
});
