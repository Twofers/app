import { describe, expect, it } from "vitest";
import { redeemDeadlineMs, isPastRedeemDeadline, VISUAL_REDEEM_AUTO_FINALIZE_MS } from "./claim-redeem-logic";

describe("redeemDeadlineMs", () => {
  it("adds grace minutes to expires_at", () => {
    const expiresAt = "2026-04-01T12:00:00.000Z";
    const deadline = redeemDeadlineMs(expiresAt, 10);
    const expected = new Date(expiresAt).getTime() + 10 * 60_000;
    expect(deadline).toBe(expected);
  });

  it("defaults to 10 minutes grace for 0 or negative", () => {
    const expiresAt = "2026-04-01T12:00:00.000Z";
    expect(redeemDeadlineMs(expiresAt, 0)).toBe(
      new Date(expiresAt).getTime() + 10 * 60_000,
    );
    expect(redeemDeadlineMs(expiresAt, -5)).toBe(
      new Date(expiresAt).getTime() + 10 * 60_000,
    );
  });
});

describe("isPastRedeemDeadline", () => {
  const expiresAt = "2026-04-01T12:00:00.000Z";
  const grace = 10;
  const deadline = new Date(expiresAt).getTime() + grace * 60_000;

  it("returns false when before deadline", () => {
    expect(isPastRedeemDeadline(deadline - 1, expiresAt, grace)).toBe(false);
  });

  it("returns true when at deadline", () => {
    expect(isPastRedeemDeadline(deadline, expiresAt, grace)).toBe(true);
  });

  it("returns true when past deadline", () => {
    expect(isPastRedeemDeadline(deadline + 60_000, expiresAt, grace)).toBe(true);
  });
});

describe("VISUAL_REDEEM_AUTO_FINALIZE_MS", () => {
  it("is 30 seconds", () => {
    expect(VISUAL_REDEEM_AUTO_FINALIZE_MS).toBe(30_000);
  });
});
