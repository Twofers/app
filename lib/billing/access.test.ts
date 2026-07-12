import { describe, expect, it } from "vitest";

import {
  PAID_BILLING_ENABLED,
  PILOT_DISABLE_BILLING_GATE,
  canCreateDeal,
  canCreateDealWithLocationBilling,
  isBusinessSelfServeMobileEnabled,
  isMobileBillingLinksEnabled,
  isMobilePaidBillingEnabled,
  isMobilePricingPageEnabled,
  isMobileStripeEnabled,
  isMobileSubscriptionCtaEnabled,
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
  it("keeps backend paid billing enabled while mobile billing defaults off", () => {
    expect(PAID_BILLING_ENABLED).toBe(true);
    expect(PILOT_DISABLE_BILLING_GATE).toBe(false);
    expect(isMobileStripeEnabled()).toBe(false);
    expect(isMobileSubscriptionCtaEnabled()).toBe(false);
    expect(isBusinessSelfServeMobileEnabled()).toBe(false);
    expect(isMobilePricingPageEnabled()).toBe(false);
    expect(isMobileBillingLinksEnabled()).toBe(false);
    expect(isMobilePaidBillingEnabled()).toBe(false);
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

  it("blocks past_due now that the testing billing bypass is disabled", () => {
    expect(PILOT_DISABLE_BILLING_GATE).toBe(false);
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "past_due",
        trialEndsAt: null,
      }),
    ).toBe(false);
  });

  it("blocks expired trials now that the testing billing bypass is disabled", () => {
    expect(PILOT_DISABLE_BILLING_GATE).toBe(false);
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "trial",
        trialEndsAt: "2000-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
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

  it("does not unlock merchant tools solely because runtime billing purchases are disabled", () => {
    expect(
      canCreateDealWithLocationBilling({
        isLoggedIn: true,
        status: "trial_eligible",
        purchaseSurface: "disabled",
        trialEndsAt: null,
        currentPeriodEndsAt: null,
      }),
    ).toBe(false);
  });

  it("blocks pending, eligible, credit-limited, and suspended states", () => {
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
      ).toBe(false);
    }
  });

  it("blocks expired canceling periods", () => {
    expect(
      canCreateDealWithLocationBilling({
        isLoggedIn: true,
        status: "paid_canceling",
        purchaseSurface: "in_app_link",
        trialEndsAt: null,
        currentPeriodEndsAt: "2000-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
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
