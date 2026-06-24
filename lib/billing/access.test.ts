import { describe, expect, it } from "vitest";

import { PAID_BILLING_ENABLED, PILOT_DISABLE_BILLING_GATE, canCreateDeal, isTrialExpired } from "./access";

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
  it("keeps paid billing surfaces enabled for this build", () => {
    expect(PAID_BILLING_ENABLED).toBe(true);
    expect(PILOT_DISABLE_BILLING_GATE).toBe(false);
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

  it("blocks past_due when the pilot billing bypass is disabled", () => {
    expect(PILOT_DISABLE_BILLING_GATE).toBe(false);
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "past_due",
        trialEndsAt: null,
      }),
    ).toBe(false);
  });

  it("blocks expired trials when the pilot billing bypass is disabled", () => {
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
