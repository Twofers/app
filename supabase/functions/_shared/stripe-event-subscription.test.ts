import { describe, expect, it } from "vitest";

import { stripeSubscriptionIdFromEventObject } from "./stripe-event-subscription";

describe("stripeSubscriptionIdFromEventObject", () => {
  it("reads the legacy top-level invoice subscription", () => {
    expect(stripeSubscriptionIdFromEventObject({ subscription: "sub_legacy" })).toBe("sub_legacy");
    expect(stripeSubscriptionIdFromEventObject({ subscription: { id: "sub_expanded" } })).toBe("sub_expanded");
  });

  it("reads the Basil/Dahlia invoice parent subscription", () => {
    expect(stripeSubscriptionIdFromEventObject({
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_dahlia" },
      },
    })).toBe("sub_dahlia");
  });

  it("does not accept unrelated invoice parents", () => {
    expect(stripeSubscriptionIdFromEventObject({
      parent: {
        type: "quote_details",
        subscription_details: { subscription: "sub_wrong_parent" },
      },
    })).toBeNull();
  });
});
