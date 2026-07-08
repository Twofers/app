import { describe, expect, it, vi } from "vitest";

import {
  isDealHiddenByRepeatPolicy,
  isRepeatClaimBlocked,
  normalizeRepeatClaimPolicyType,
} from "./repeat-claim-visibility";

// The module imports the supabase client (→ react-native) at load time for its DB loaders.
// These tests only cover the pure predicates, so stub the client to keep it out of the graph.
// vi.mock is hoisted above the import above by vitest, so the stub is in place at load time.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

describe("normalizeRepeatClaimPolicyType", () => {
  it("keeps supported values and falls back to NONE", () => {
    expect(normalizeRepeatClaimPolicyType("COOLDOWN_DAYS")).toBe("COOLDOWN_DAYS");
    expect(normalizeRepeatClaimPolicyType("FOREVER")).toBe("FOREVER");
    expect(normalizeRepeatClaimPolicyType("NONE")).toBe("NONE");
    expect(normalizeRepeatClaimPolicyType(null)).toBe("NONE");
    expect(normalizeRepeatClaimPolicyType("WEEKLY")).toBe("NONE");
  });
});

describe("isRepeatClaimBlocked", () => {
  const redeemedAt = "2026-06-01T15:30:00.000Z";
  const now = Date.parse("2026-06-15T15:30:00.000Z");

  it("never blocks with no prior redemption", () => {
    expect(
      isRepeatClaimBlocked({ policyType: "FOREVER", cooldownDays: null, lastRedeemedAt: null, nowMs: now }),
    ).toBe(false);
  });

  it("never blocks under NONE", () => {
    expect(
      isRepeatClaimBlocked({ policyType: "NONE", cooldownDays: null, lastRedeemedAt: redeemedAt, nowMs: now }),
    ).toBe(false);
  });

  it("blocks forever after any redemption under FOREVER", () => {
    expect(
      isRepeatClaimBlocked({ policyType: "FOREVER", cooldownDays: null, lastRedeemedAt: redeemedAt, nowMs: now }),
    ).toBe(true);
  });

  it("blocks inside the cooldown window and clears at the exact boundary", () => {
    expect(
      isRepeatClaimBlocked({
        policyType: "COOLDOWN_DAYS",
        cooldownDays: 7,
        lastRedeemedAt: redeemedAt,
        nowMs: Date.parse("2026-06-08T15:29:59.999Z"),
      }),
    ).toBe(true);
    expect(
      isRepeatClaimBlocked({
        policyType: "COOLDOWN_DAYS",
        cooldownDays: 7,
        lastRedeemedAt: redeemedAt,
        nowMs: Date.parse("2026-06-08T15:30:00.000Z"),
      }),
    ).toBe(false);
  });

  it("does not block when a cooldown policy has an invalid day count", () => {
    expect(
      isRepeatClaimBlocked({ policyType: "COOLDOWN_DAYS", cooldownDays: 0, lastRedeemedAt: redeemedAt, nowMs: now }),
    ).toBe(false);
  });
});

describe("isDealHiddenByRepeatPolicy", () => {
  const now = Date.parse("2026-06-15T15:30:00.000Z");

  it("hides a deal for a first-time-only business the customer already redeemed at", () => {
    expect(
      isDealHiddenByRepeatPolicy({
        policy: { repeat_claim_policy_type: "FOREVER", repeat_claim_cooldown_days: null },
        lastRedeemedAt: "2026-06-01T15:30:00.000Z",
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("keeps a deal visible when the customer has never redeemed there", () => {
    expect(
      isDealHiddenByRepeatPolicy({
        policy: { repeat_claim_policy_type: "FOREVER", repeat_claim_cooldown_days: null },
        lastRedeemedAt: null,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("keeps a deal visible when the business has no repeat limit or unknown policy", () => {
    expect(
      isDealHiddenByRepeatPolicy({
        policy: { repeat_claim_policy_type: "NONE", repeat_claim_cooldown_days: null },
        lastRedeemedAt: "2026-06-01T15:30:00.000Z",
        nowMs: now,
      }),
    ).toBe(false);
    expect(
      isDealHiddenByRepeatPolicy({ policy: null, lastRedeemedAt: "2026-06-01T15:30:00.000Z", nowMs: now }),
    ).toBe(false);
  });
});
