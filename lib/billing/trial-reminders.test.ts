import { describe, expect, it } from "vitest";

import { canManageBillingInPortal, getTrialReminderWindowDays } from "./trial-reminders";

const NOW = Date.UTC(2026, 5, 21, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function isoAfter(days: number): string {
  return new Date(NOW + days * DAY_MS).toISOString();
}

describe("getTrialReminderWindowDays", () => {
  it("returns the active trial reminder window for 7, 3, and 1 day bands", () => {
    expect(getTrialReminderWindowDays("trial_active", isoAfter(7), NOW)).toBe(7);
    expect(getTrialReminderWindowDays("trial_active", isoAfter(3), NOW)).toBe(3);
    expect(getTrialReminderWindowDays("trial_active", isoAfter(1), NOW)).toBe(1);
  });

  it("uses the nearest stronger warning once inside a band", () => {
    expect(getTrialReminderWindowDays("trial_active", isoAfter(6), NOW)).toBe(7);
    expect(getTrialReminderWindowDays("trial_active", isoAfter(2), NOW)).toBe(3);
    expect(getTrialReminderWindowDays("trial_active", new Date(NOW + 2 * 60 * 60 * 1000).toISOString(), NOW)).toBe(1);
  });

  it("does not show auto-billing reminders for ineligible statuses or invalid dates", () => {
    expect(getTrialReminderWindowDays("trial_canceling", isoAfter(1), NOW)).toBeNull();
    expect(getTrialReminderWindowDays("admin_trial_active", isoAfter(1), NOW)).toBeNull();
    expect(getTrialReminderWindowDays("trial_active", isoAfter(8), NOW)).toBeNull();
    expect(getTrialReminderWindowDays("trial_active", "bad", NOW)).toBeNull();
    expect(getTrialReminderWindowDays("trial_active", null, NOW)).toBeNull();
  });
});

describe("canManageBillingInPortal", () => {
  it("allows Stripe portal management during trials and paid subscriptions", () => {
    expect(canManageBillingInPortal("trial_active")).toBe(true);
    expect(canManageBillingInPortal("trial_canceling")).toBe(true);
    expect(canManageBillingInPortal("paid_active")).toBe(true);
    expect(canManageBillingInPortal("paid_canceling")).toBe(true);
  });

  it("does not expose portal management for non-Stripe or suspended states", () => {
    expect(canManageBillingInPortal("trial_eligible")).toBe(false);
    expect(canManageBillingInPortal("admin_trial_active")).toBe(false);
    expect(canManageBillingInPortal("payment_failed_suspended")).toBe(false);
  });
});
