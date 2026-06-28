import { describe, expect, it } from "vitest";

import {
  PAID_BILLING_ENABLED,
  PILOT_DISABLE_BILLING_GATE,
  canCreateDeal,
  canCreateDealWithLocationBilling,
  isTrialExpired,
} from "./access";

describe("isTrialExpired", () => {
  it("returns false for a future trial end", () => {
    expect(isTrialExpired("2999-01-01T00:00:00.000Z")).toBe(false);
  });

  it("returns true for a past trial end", () => {
    expect(isTrialExpired("2000-01-01T00:00:00.000Z")).toBe(true);
  });

  it("treats missing trial end as expired", () => {
    expect(isTrialExpired(null)).toBe(true);
  });

  it("treats invalid trial end as expired", () => {
    expect(isTrialExpired("not-a-date")).toBe(true);
  });
});

describe("canCreateDeal", () => {
  it("keeps paid billing surfaces visible while bypassing enforcement for testing", () => {
    expect(PAID_BILLING_ENABLED).toBe(true);
    expect(PILOT_DISABLE_BILLING_GATE).toBe(true);
  });

  it("blocks unauthenticated callers regardless of any other state", () => {
    expect(
      canCreateDeal({
        isLoggedIn: false,
        subscriptionStatus: "active",
        trialEndsAt: "2999-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("allows active subscriptions", () => {
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "active",
        trialEndsAt: null,
      }),
    ).toBe(true);
  });

  it("allows trial with valid end date", () => {
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "trial",
        trialEndsAt: "2999-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("allows trial with null trialEndsAt (trial just created)", () => {
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "trial",
        trialEndsAt: null,
      }),
    ).toBe(true);
  });

  it("allows past_due while the testing billing bypass is enabled", () => {
    expect(PILOT_DISABLE_BILLING_GATE).toBe(true);
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "past_due",
        trialEndsAt: null,
      }),
    ).toBe(true);
  });

  it("allows expired trials while the testing billing bypass is enabled", () => {
    expect(PILOT_DISABLE_BILLING_GATE).toBe(true);
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "trial",
        trialEndsAt: "2000-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("canCreateDealWithLocationBilling", () => {
  it("blocks unauthenticated callers", () => {
    expect(
      canCreateDealWithLocationBilling({
        isLoggedIn: false,
        status: "paid_active",
        purchaseSurface: "in_app_link",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
      }),
    ).toBe(false);
  });

  it("allows active and canceling paid subscriptions", () => {
    for (const status of ["pro_active", "paid_active", "pro_canceling", "paid_canceling"] as const) {
      expect(
        canCreateDealWithLocationBilling({
          isLoggedIn: true,
          status,
          purchaseSurface: "in_app_link",
          trialEndsAt: null,
          currentPeriodEndsAt: "2999-01-01T00:00:00.000Z",
        }),
      ).toBe(true);
    }
  });

  it("allows active trial states with current access", () => {
    for (const status of ["trial_active", "trial_canceling", "admin_trial_active"] as const) {
      expect(
        canCreateDealWithLocationBilling({
          isLoggedIn: true,
          status,
          purchaseSurface: "in_app_link",
          trialEndsAt: "2999-01-01T00:00:00.000Z",
          currentPeriodEndsAt: null,
        }),
      ).toBe(true);
    }
  });

  it("allows deal creation when runtime billing purchases are disabled", () => {
    expect(
      canCreateDealWithLocationBilling({
        isLoggedIn: true,
        status: "trial_eligible",
        purchaseSurface: "disabled",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
      }),
    ).toBe(true);
  });

  it("allows pending, eligible, credit-limited, and suspended states while the testing billing bypass is enabled", () => {
    for (const status of [
      "trial_eligible",
      "trial_checkout_pending",
      "trial_credit_limit_reached",
      "trial_expired_suspended",
      "payment_failed_suspended",
      "canceled_suspended",
    ] as const) {
      expect(
        canCreateDealWithLocationBilling({
          isLoggedIn: true,
          status,
          purchaseSurface: "in_app_link",
          trialEndsAt: "2999-01-01T00:00:00.000Z",
          currentPeriodEndsAt: "2999-01-01T00:00:00.000Z",
        }),
      ).toBe(true);
    }
  });

  it("allows expired canceling periods while the testing billing bypass is enabled", () => {
    expect(
      canCreateDealWithLocationBilling({
        isLoggedIn: true,
        status: "paid_canceling",
        purchaseSurface: "in_app_link",
        trialEndsAt: null,
        currentPeriodEndsAt: "2000-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("allows the development billing bypass", () => {
    expect(
      canCreateDealWithLocationBilling({
        isLoggedIn: true,
        status: "payment_failed_suspended",
        purchaseSurface: "in_app_link",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
        bypass: true,
      }),
    ).toBe(true);
  });
});
