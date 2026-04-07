import { describe, expect, it } from "vitest";

import { canCreateDeal, isTrialExpired } from "./access";

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
  it("blocks when past due", () => {
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "past_due",
        trialEndsAt: null,
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

  it("allows trial status only when trial is still valid", () => {
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "trial",
        trialEndsAt: "2999-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("allows trial status with null trialEndsAt (trial just created, date not yet set)", () => {
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "trial",
        trialEndsAt: null,
      }),
    ).toBe(true);
  });

  it("blocks expired trial", () => {
    expect(
      canCreateDeal({
        isLoggedIn: true,
        subscriptionStatus: "trial",
        trialEndsAt: "2000-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});
