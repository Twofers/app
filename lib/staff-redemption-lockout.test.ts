// Tests for the staff redemption brute-force lockout decisions (audit Finding 4,
// batch R4). Lives under lib/ because supabase/functions is deno-checked per
// file; the module under test is pure.
import { describe, expect, it } from "vitest";
import {
  failedStaffAttemptReason,
  isStaffRedemptionLockedOut,
  STAFF_LOCKOUT_MAX_FAILURES,
  STAFF_LOCKOUT_WINDOW_MS,
} from "../supabase/functions/_shared/staff-redemption-lockout";

describe("failedStaffAttemptReason", () => {
  it("counts unknown/foreign codes and expired codes as guesses", () => {
    // not_found covers both unknown codes and another business's codes — the
    // RPC intentionally collapses them, matching redeem-token's
    // unknown_code/wrong_business recording.
    expect(failedStaffAttemptReason("not_found")).toBe("unknown_code");
    expect(failedStaffAttemptReason("expired")).toBe("expired");
  });

  it("never counts honest already-redeemed re-scans (Batch 6 judgment)", () => {
    expect(failedStaffAttemptReason("already_redeemed")).toBeNull();
    expect(failedStaffAttemptReason("not_redeemable")).toBeNull();
  });

  it("never counts non-guess failures", () => {
    expect(failedStaffAttemptReason("invalid_input")).toBeNull();
    expect(failedStaffAttemptReason("deal_inactive")).toBeNull();
    expect(failedStaffAttemptReason("unauthorized")).toBeNull();
    expect(failedStaffAttemptReason(undefined)).toBeNull();
    expect(failedStaffAttemptReason("")).toBeNull();
  });
});

describe("isStaffRedemptionLockedOut", () => {
  it("locks at the redeem-token threshold (10 in the rolling window)", () => {
    expect(STAFF_LOCKOUT_MAX_FAILURES).toBe(10);
    expect(STAFF_LOCKOUT_WINDOW_MS).toBe(5 * 60 * 1000);
    expect(isStaffRedemptionLockedOut(10)).toBe(true);
    expect(isStaffRedemptionLockedOut(25)).toBe(true);
  });

  it("stays open below the threshold and when the count is unavailable", () => {
    expect(isStaffRedemptionLockedOut(9)).toBe(false);
    expect(isStaffRedemptionLockedOut(0)).toBe(false);
    // A failed count query must fail open (matching redeem-token), never 429.
    expect(isStaffRedemptionLockedOut(null)).toBe(false);
    expect(isStaffRedemptionLockedOut(undefined)).toBe(false);
  });
});
