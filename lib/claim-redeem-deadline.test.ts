import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLAIM_GRACE_MINUTES,
  getClaimRedeemDeadlineIso,
  isPastClaimRedeemDeadline,
} from "./claim-redeem-deadline";

describe("getClaimRedeemDeadlineIso", () => {
  it("adds grace minutes to expiry", () => {
    const expiresAt = "2026-04-01T12:00:00.000Z";
    const result = getClaimRedeemDeadlineIso(expiresAt, 10);
    expect(result).toBe("2026-04-01T12:10:00.000Z");
  });

  it("uses default grace when not specified", () => {
    const expiresAt = "2026-04-01T12:00:00.000Z";
    const result = getClaimRedeemDeadlineIso(expiresAt, DEFAULT_CLAIM_GRACE_MINUTES);
    const expected = new Date(
      new Date(expiresAt).getTime() + DEFAULT_CLAIM_GRACE_MINUTES * 60_000,
    ).toISOString();
    expect(result).toBe(expected);
  });
});

describe("isPastClaimRedeemDeadline", () => {
  const expiresAt = "2026-04-01T12:00:00.000Z";
  const grace = 10;
  const deadlineMs = new Date(expiresAt).getTime() + grace * 60_000;

  it("returns false before deadline", () => {
    expect(isPastClaimRedeemDeadline(expiresAt, deadlineMs - 1000, grace)).toBe(false);
  });

  it("returns true at deadline", () => {
    expect(isPastClaimRedeemDeadline(expiresAt, deadlineMs, grace)).toBe(true);
  });

  it("returns true after deadline", () => {
    expect(isPastClaimRedeemDeadline(expiresAt, deadlineMs + 60_000, grace)).toBe(true);
  });
});
