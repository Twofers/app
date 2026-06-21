import { describe, expect, it } from "vitest";

import {
  createSafeDisabledBillingSummary,
  isBillingStatusCreditBlocked,
  normalizePurchaseSurface,
  parseLocationBillingSummary,
} from "./entitlements";

describe("billing entitlement parsing", () => {
  it("fails closed to disabled purchase surface for missing or invalid values", () => {
    expect(normalizePurchaseSurface(undefined)).toBe("disabled");
    expect(normalizePurchaseSurface("banana")).toBe("disabled");
    expect(normalizePurchaseSurface("web_only")).toBe("web_only");
  });

  it("creates a disabled safe summary when the RPC payload is missing", () => {
    expect(createSafeDisabledBillingSummary("loc_1")).toMatchObject({
      businessLocationId: "loc_1",
      status: "trial_eligible",
      purchaseSurface: "disabled",
      configuredTrialAllowance: 30,
      configuredPaidAllowance: 60,
    });
    expect(parseLocationBillingSummary(null, "loc_1")).toMatchObject({
      businessLocationId: "loc_1",
      purchaseSurface: "disabled",
    });
  });

  it("normalizes Supabase snake_case billing summary rows", () => {
    expect(
      parseLocationBillingSummary({
        business_location_id: "loc_2",
        status: "trial_active",
        trial_started_at: "2026-06-21T00:00:00.000Z",
        trial_ends_at: "2026-07-21T00:00:00.000Z",
        current_period_started_at: "2026-06-21T00:00:00.000Z",
        current_period_ends_at: "2026-07-21T00:00:00.000Z",
        cancel_at_period_end: false,
        suspension_reason: null,
        credits_granted: 30,
        credits_used: 8,
        credits_reserved: 2,
        credits_remaining: 20,
        refund_eligible: false,
        purchase_surface: "in_app_link",
        configured_trial_allowance: 30,
        configured_paid_allowance: 60,
      }),
    ).toEqual({
      businessLocationId: "loc_2",
      status: "trial_active",
      trialStartedAt: "2026-06-21T00:00:00.000Z",
      trialEndsAt: "2026-07-21T00:00:00.000Z",
      currentPeriodStartedAt: "2026-06-21T00:00:00.000Z",
      currentPeriodEndsAt: "2026-07-21T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      suspensionReason: null,
      creditsGranted: 30,
      creditsUsed: 8,
      creditsReserved: 2,
      creditsRemaining: 20,
      refundEligible: false,
      purchaseSurface: "in_app_link",
      configuredTrialAllowance: 30,
      configuredPaidAllowance: 60,
    });
  });

  it("treats suspended and limit-reached states as credit blocked", () => {
    expect(isBillingStatusCreditBlocked("trial_credit_limit_reached")).toBe(true);
    expect(isBillingStatusCreditBlocked("payment_failed_suspended")).toBe(true);
    expect(isBillingStatusCreditBlocked("paid_active")).toBe(false);
  });
});
