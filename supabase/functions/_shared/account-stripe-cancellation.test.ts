import { describe, expect, it } from "vitest";

import { uniqueStripeSubscriptionIds } from "./account-stripe-cancellation";

describe("account Stripe cancellation", () => {
  it("deduplicates valid Stripe subscription ids across billing mirrors", () => {
    expect(uniqueStripeSubscriptionIds([
      "sub_paid",
      " sub_paid ",
      "sub_trial",
      null,
      "cus_not_a_subscription",
      "",
    ])).toEqual(["sub_paid", "sub_trial"]);
  });

  it("rejects malformed provider ids instead of sending them to Stripe", () => {
    expect(uniqueStripeSubscriptionIds([12, {}, "price_123", "subscription_123"])).toEqual([]);
  });
});
