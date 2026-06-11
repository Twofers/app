/**
 * Brute-force lockout for the staff redemption path (audit Finding 4, batch R4).
 *
 * Mirrors the Batch 6 redeem-token judgment: 10 failed guesses inside a rolling
 * 5-minute window locks the caller out with a 429, and honest re-scans of an
 * already-redeemed code never count. Scoping is per counter device (the JWT's
 * server-set redemption_device_id) because every device in a shop shares one IP.
 *
 * Pure module so the decision logic is unit-testable under vitest.
 */

export const STAFF_LOCKOUT_MAX_FAILURES = 10;
export const STAFF_LOCKOUT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Maps a staff RPC failure status to the failed_redeem_attempts.reason to
 * record, or null when the attempt must NOT count toward the lockout:
 * - not_found: a guess (unknown code, or another business's code — the RPC
 *   intentionally collapses both); matches redeem-token's unknown_code /
 *   wrong_business recording.
 * - expired: matches redeem-token, which records expired codes.
 * - already_redeemed / not_redeemable: honest re-scan of a used code — never
 *   counted (Batch 6 judgment).
 * - invalid_input / deal_inactive / unauthorized: not code guesses.
 */
export function failedStaffAttemptReason(status: unknown): string | null {
  switch (status) {
    case "not_found":
      return "unknown_code";
    case "expired":
      return "expired";
    default:
      return null;
  }
}

/** True when the recent failure count has reached the lockout threshold. */
export function isStaffRedemptionLockedOut(recentFailures: number | null | undefined): boolean {
  return typeof recentFailures === "number" && recentFailures >= STAFF_LOCKOUT_MAX_FAILURES;
}
