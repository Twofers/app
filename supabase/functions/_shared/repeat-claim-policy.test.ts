import { describe, expect, it } from "vitest";

import { evaluateRepeatClaimPolicy, normalizeRepeatClaimPolicyType } from "./repeat-claim-policy.ts";

describe("normalizeRepeatClaimPolicyType", () => {
  it("keeps supported repeat policy values", () => {
    expect(normalizeRepeatClaimPolicyType("NONE")).toBe("NONE");
    expect(normalizeRepeatClaimPolicyType("COOLDOWN_DAYS")).toBe("COOLDOWN_DAYS");
    expect(normalizeRepeatClaimPolicyType("FOREVER")).toBe("FOREVER");
  });

  it("falls back to no limit for unknown values", () => {
    expect(normalizeRepeatClaimPolicyType(null)).toBe("NONE");
    expect(normalizeRepeatClaimPolicyType("DAILY")).toBe("NONE");
  });
});

describe("evaluateRepeatClaimPolicy", () => {
  const redeemedAt = "2026-06-01T15:30:00.000Z";

  it("allows repeat claims when there is no prior redemption", () => {
    expect(
      evaluateRepeatClaimPolicy({
        policyType: "FOREVER",
        cooldownDays: null,
        lastRedeemedAt: null,
        nowMs: Date.parse("2026-06-15T15:30:00.000Z"),
      }),
    ).toBeNull();
  });

  it("allows repeat claims when policy is no limit", () => {
    expect(
      evaluateRepeatClaimPolicy({
        policyType: "NONE",
        cooldownDays: null,
        lastRedeemedAt: redeemedAt,
        nowMs: Date.parse("2026-06-02T15:30:00.000Z"),
      }),
    ).toBeNull();
  });

  it("blocks forever after one successful redemption", () => {
    expect(
      evaluateRepeatClaimPolicy({
        policyType: "FOREVER",
        cooldownDays: null,
        lastRedeemedAt: redeemedAt,
        nowMs: Date.parse("2026-06-15T15:30:00.000Z"),
      }),
    ).toMatchObject({
      errorCode: "BUSINESS_REPEAT_LIMIT_FOREVER",
    });
  });

  it("blocks during cooldown from the exact redemption timestamp", () => {
    expect(
      evaluateRepeatClaimPolicy({
        policyType: "COOLDOWN_DAYS",
        cooldownDays: 7,
        lastRedeemedAt: redeemedAt,
        nowMs: Date.parse("2026-06-08T15:29:59.999Z"),
      }),
    ).toMatchObject({
      errorCode: "BUSINESS_REPEAT_LIMIT_COOLDOWN",
      nextEligibleAt: "2026-06-08T15:30:00.000Z",
    });
  });

  it("allows at the exact cooldown timestamp", () => {
    expect(
      evaluateRepeatClaimPolicy({
        policyType: "COOLDOWN_DAYS",
        cooldownDays: 7,
        lastRedeemedAt: redeemedAt,
        nowMs: Date.parse("2026-06-08T15:30:00.000Z"),
      }),
    ).toBeNull();
  });
});
