import { describe, expect, it } from "vitest";

import {
  INTRODUCTORY_REFUND_WINDOW_DAYS,
  decideIntroductoryRefund,
  isWithinIntroductoryRefundWindow,
  nonNegativeInteger,
} from "./introductory-refund.ts";

const NOW = Date.UTC(2026, 5, 21, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe("isWithinIntroductoryRefundWindow", () => {
  it("accepts first paid timestamps within seven calendar days", () => {
    expect(isWithinIntroductoryRefundWindow(new Date(NOW - INTRODUCTORY_REFUND_WINDOW_DAYS * DAY_MS).toISOString(), NOW)).toBe(true);
    expect(isWithinIntroductoryRefundWindow(new Date(NOW - 2 * DAY_MS).toISOString(), NOW)).toBe(true);
  });

  it("rejects missing, invalid, future, or expired timestamps", () => {
    expect(isWithinIntroductoryRefundWindow(null, NOW)).toBe(false);
    expect(isWithinIntroductoryRefundWindow("bad", NOW)).toBe(false);
    expect(isWithinIntroductoryRefundWindow(new Date(NOW + DAY_MS).toISOString(), NOW)).toBe(false);
    expect(isWithinIntroductoryRefundWindow(new Date(NOW - 8 * DAY_MS).toISOString(), NOW)).toBe(false);
  });
});

describe("decideIntroductoryRefund", () => {
  it("approves first paid invoice refunds inside the window when no usage guard blocks it", () => {
    expect(
      decideIntroductoryRefund({
        firstPaidAt: new Date(NOW - DAY_MS).toISOString(),
        introductoryRefundUsedAt: null,
        creditsUsed: 4,
        refundMaxPaidCreditsUsed: null,
        nowMs: NOW,
      }),
    ).toEqual({ eligible: true, reason: "eligible" });
  });

  it("returns explicit rejection reasons", () => {
    expect(
      decideIntroductoryRefund({
        firstPaidAt: null,
        introductoryRefundUsedAt: null,
        creditsUsed: 0,
        refundMaxPaidCreditsUsed: null,
        nowMs: NOW,
      }).reason,
    ).toBe("missing_first_paid_at");
    expect(
      decideIntroductoryRefund({
        firstPaidAt: new Date(NOW - DAY_MS).toISOString(),
        introductoryRefundUsedAt: new Date(NOW).toISOString(),
        creditsUsed: 0,
        refundMaxPaidCreditsUsed: null,
        nowMs: NOW,
      }).reason,
    ).toBe("already_refunded");
    expect(
      decideIntroductoryRefund({
        firstPaidAt: new Date(NOW - 8 * DAY_MS).toISOString(),
        introductoryRefundUsedAt: null,
        creditsUsed: 0,
        refundMaxPaidCreditsUsed: null,
        nowMs: NOW,
      }).reason,
    ).toBe("outside_window");
    expect(
      decideIntroductoryRefund({
        firstPaidAt: new Date(NOW - DAY_MS).toISOString(),
        introductoryRefundUsedAt: null,
        creditsUsed: 3,
        refundMaxPaidCreditsUsed: 2,
        nowMs: NOW,
      }).reason,
    ).toBe("usage_requires_support");
  });
});

describe("nonNegativeInteger", () => {
  it("normalizes unknown numeric inputs safely", () => {
    expect(nonNegativeInteger("4")).toBe(4);
    expect(nonNegativeInteger(-2)).toBe(0);
    expect(nonNegativeInteger("bad", 7)).toBe(7);
  });
});
