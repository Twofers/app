import { describe, expect, it } from "vitest";

import {
  resolveBusinessApplicationStateForAppAccessStatus,
  resolveBusinessAccessLevelForAppAccessStatus,
  resolveBusinessStatusForAppAccessStatus,
  resolveLocationEntitlementStatus,
} from "./business-location-entitlement-sync.ts";

describe("resolveBusinessApplicationStateForAppAccessStatus", () => {
  it("mirrors setup, trial, paid, and grace access into application state", () => {
    expect(resolveBusinessApplicationStateForAppAccessStatus("approved_not_activated")).toEqual({
      status: "approved_not_activated",
      accessTier: "approved_not_activated",
    });
    expect(resolveBusinessApplicationStateForAppAccessStatus("trialing")).toEqual({
      status: "trial_active",
      accessTier: "trialing",
    });
    expect(resolveBusinessApplicationStateForAppAccessStatus("active")).toEqual({
      status: "active",
      accessTier: "active",
    });
    expect(resolveBusinessApplicationStateForAppAccessStatus("past_due_grace")).toEqual({
      status: "active",
      accessTier: "active",
    });
  });

  it("mirrors terminal and support-only lifecycle states", () => {
    expect(resolveBusinessApplicationStateForAppAccessStatus("expired")).toEqual({
      status: "expired",
      accessTier: "expired",
    });
    expect(resolveBusinessApplicationStateForAppAccessStatus("canceled")).toEqual({
      status: "canceled",
      accessTier: "canceled",
    });
    expect(resolveBusinessApplicationStateForAppAccessStatus("suspended")).toEqual({
      status: "suspended",
      accessTier: "suspended",
    });
    expect(resolveBusinessApplicationStateForAppAccessStatus("pending")).toBeNull();
  });
});

describe("resolveBusinessAccessLevelForAppAccessStatus", () => {
  it("grants paid access for active and grace-period statuses", () => {
    expect(resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "active", currentAccessLevel: null }))
      .toBe("paid");
    expect(
      resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "past_due_grace", currentAccessLevel: "paid" }),
    ).toBe("paid");
  });

  it("maps trial statuses to the matching trial access level", () => {
    expect(resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "trialing", currentAccessLevel: null }))
      .toBe("full_trial");
    expect(
      resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "trial_limited", currentAccessLevel: null }),
    ).toBe("limited_trial");
  });

  it("preserves approved setup-only access without granting paid or trial access", () => {
    expect(
      resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "approved_not_activated", currentAccessLevel: null }),
    ).toBe("approved_not_activated");
  });

  it("explicitly downgrades canceled, expired, blocked, and suspended statuses to none", () => {
    for (const status of ["canceled", "expired", "blocked", "suspended"]) {
      expect(
        resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: status, currentAccessLevel: "paid" }),
      ).toBe("none");
    }
  });

  it("never downgrades a canceled subscriber to null (the original bug)", () => {
    const result = resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "canceled", currentAccessLevel: "paid" });
    expect(result).not.toBeNull();
    expect(result).toBe("none");
  });

  it("never touches comped or internal accounts", () => {
    for (const currentAccessLevel of ["admin_comped", "partner_comped", "internal_test"]) {
      expect(
        resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "canceled", currentAccessLevel }),
      ).toBeNull();
    }
  });

  it("leaves pending and comped statuses unchanged", () => {
    expect(resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "pending", currentAccessLevel: null }))
      .toBeNull();
    expect(resolveBusinessAccessLevelForAppAccessStatus({ appAccessStatus: "comped", currentAccessLevel: null }))
      .toBeNull();
  });
});

describe("resolveBusinessStatusForAppAccessStatus", () => {
  it("shows past_due during grace instead of active or canceled", () => {
    const status = resolveBusinessStatusForAppAccessStatus({ appAccessStatus: "past_due_grace", currentAccessLevel: "paid" });
    expect(status).toBe("past_due");
    expect(status).not.toBe("active");
    expect(status).not.toBe("canceled");
  });

  it("marks canceled explicitly", () => {
    expect(resolveBusinessStatusForAppAccessStatus({ appAccessStatus: "canceled", currentAccessLevel: "paid" }))
      .toBe("canceled");
  });

  it("keeps approved setup-only businesses in the setup-only status", () => {
    expect(
      resolveBusinessStatusForAppAccessStatus({ appAccessStatus: "approved_not_activated", currentAccessLevel: null }),
    ).toBe("approved_not_activated");
  });

  it("never touches comped accounts", () => {
    expect(
      resolveBusinessStatusForAppAccessStatus({ appAccessStatus: "canceled", currentAccessLevel: "admin_comped" }),
    ).toBeNull();
  });
});

describe("resolveLocationEntitlementStatus", () => {
  it("maps admin card-free trials to admin_trial_active", () => {
    expect(
      resolveLocationEntitlementStatus({ appAccessStatus: "trial_limited", trialType: "remote_limited", cancelAtPeriodEnd: false }),
    ).toBe("admin_trial_active");
    expect(
      resolveLocationEntitlementStatus({ appAccessStatus: "trialing", trialType: "remote_full", cancelAtPeriodEnd: false }),
    ).toBe("admin_trial_active");
  });

  it("maps Stripe-trial statuses to trial_active/trial_canceling", () => {
    expect(
      resolveLocationEntitlementStatus({ appAccessStatus: "trialing", trialType: "stripe_trial", cancelAtPeriodEnd: false }),
    ).toBe("trial_active");
    expect(
      resolveLocationEntitlementStatus({ appAccessStatus: "trialing", trialType: "stripe_trial", cancelAtPeriodEnd: true }),
    ).toBe("trial_canceling");
  });

  it("maps active paid subscriptions to pro_active/pro_canceling", () => {
    expect(resolveLocationEntitlementStatus({ appAccessStatus: "active", trialType: "paid", cancelAtPeriodEnd: false }))
      .toBe("pro_active");
    expect(resolveLocationEntitlementStatus({ appAccessStatus: "active", trialType: "paid", cancelAtPeriodEnd: true }))
      .toBe("pro_canceling");
  });

  it("keeps access during grace instead of suspending immediately", () => {
    expect(
      resolveLocationEntitlementStatus({ appAccessStatus: "past_due_grace", trialType: "paid", cancelAtPeriodEnd: false }),
    ).toBe("pro_active");
  });

  it("suspends on canceled, expired, blocked, and suspended", () => {
    for (const status of ["canceled", "expired", "blocked", "suspended"]) {
      expect(
        resolveLocationEntitlementStatus({ appAccessStatus: status, trialType: "paid", cancelAtPeriodEnd: false }),
      ).toBe("canceled_suspended");
    }
  });

  it("does not clobber comped entitlements", () => {
    expect(resolveLocationEntitlementStatus({ appAccessStatus: "comped", trialType: null, cancelAtPeriodEnd: false }))
      .toBeNull();
  });

  it("defaults unrecognized/pending statuses to trial_eligible", () => {
    expect(resolveLocationEntitlementStatus({ appAccessStatus: "pending", trialType: null, cancelAtPeriodEnd: false }))
      .toBe("trial_eligible");
  });

  it("maps approved setup-only subscriptions to trial eligible entitlements without granting credits", () => {
    expect(
      resolveLocationEntitlementStatus({
        appAccessStatus: "approved_not_activated",
        trialType: null,
        cancelAtPeriodEnd: false,
      }),
    ).toBe("trial_eligible");
  });
});
