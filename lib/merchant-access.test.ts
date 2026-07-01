import { describe, expect, it } from "vitest";

import { createSafeDisabledBillingSummary, type LocationBillingSummary } from "@/lib/billing/entitlements";
import { getMerchantAccessForBillingSummary, isMerchantAccessAllowedStatus } from "./merchant-access";

function summary(status: LocationBillingSummary["status"]): LocationBillingSummary {
  return {
    ...createSafeDisabledBillingSummary("loc_1"),
    status,
  };
}

describe("merchant access status gate", () => {
  it("allows active, trial-active, and canceling grace statuses", () => {
    for (const status of [
      "trial_active",
      "admin_trial_active",
      "trial_canceling",
      "pro_active",
      "pro_canceling",
      "paid_active",
      "paid_canceling",
    ] as const) {
      expect(isMerchantAccessAllowedStatus(status)).toBe(true);
    }
  });

  it("blocks pending, eligible, canceled, and suspended statuses", () => {
    for (const status of [
      "trial_eligible",
      "trial_checkout_pending",
      "trial_credit_limit_reached",
      "trial_expired_suspended",
      "payment_failed_suspended",
      "canceled_suspended",
      "refunded_suspended",
    ] as const) {
      expect(isMerchantAccessAllowedStatus(status)).toBe(false);
    }
  });

  it("returns a simple blocked result for inactive merchants", () => {
    expect(
      getMerchantAccessForBillingSummary({
        isLoggedIn: true,
        businessId: "biz_1",
        summary: summary("trial_eligible"),
      }),
    ).toEqual({
      canAccessMerchantTools: false,
      status: "trial_eligible",
      reason: "inactive_status",
    });
  });

  it("allows explicit development bypasses", () => {
    expect(
      getMerchantAccessForBillingSummary({
        isLoggedIn: true,
        businessId: "biz_1",
        summary: summary("payment_failed_suspended"),
        bypass: true,
      }),
    ).toMatchObject({
      canAccessMerchantTools: true,
      status: "payment_failed_suspended",
      reason: "development_bypass",
    });
  });
});
