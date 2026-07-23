import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redeemDeadlineMs, isPastRedeemDeadline } from "./claim-redeem-logic.ts";

// Audit F-004: every server path must treat a claim as "over" only at the
// shared redeem deadline (expires_at + grace_period_minutes), never at nominal
// expires_at. The redemption paths (begin/complete visual, redeem-token,
// finalize-stale-redeems) already did; claim-deal and release-claim used raw
// expires_at, which could expire a still-redeemable claim mid-grace and let a
// second logical claim through. These guards pin the fixed invariant.

function readFunctionSource(name: string): string {
  return readFileSync(join(process.cwd(), "supabase", "functions", name, "index.ts"), "utf8");
}

describe("claim/release honor the shared redeem grace deadline (audit F-004)", () => {
  it("claim-deal imports the shared deadline helper and has no nominal-expiry sweep", () => {
    const source = readFunctionSource("claim-deal");
    expect(source).toMatch(/import \{ isPastRedeemDeadline \} from "\.\.\/_shared\/claim-redeem\.ts"/);
    // The old blind bulk-expire at raw expires_at must not come back.
    expect(source).not.toMatch(/\.lte\("expires_at"/);
    // The active-claim gate and the expiry sweep both go through the per-row
    // deadline (grace included).
    expect(source).toMatch(/isPastRedeemDeadline\(nowMs, row\.expires_at, row\.grace_period_minutes as number\)/);
    expect(source).toMatch(/const staleIds = /);
    expect(source).toMatch(/!isPastDeadline\(row\)/);
  });

  it("claim-deal's expiry sweep is one batched update with the status/unredeemed guards", () => {
    const source = readFunctionSource("claim-deal");
    const sweep = source.match(/if \(staleIds\.length > 0\)[\s\S]*?\.is\("redeemed_at", null\);/);
    expect(sweep, "guarded batched expiry sweep must exist").toBeTruthy();
    expect(sweep![0]).toMatch(/\.in\("id", staleIds\)/);
    expect(sweep![0]).toMatch(/\.in\("claim_status", \["active", "redeeming"\]\)/);
    expect(sweep![0]).toMatch(/redeem_started_at: null/);
  });

  it("release-claim expires only at the shared deadline and reads per-claim grace", () => {
    const source = readFunctionSource("release-claim");
    expect(source).toMatch(/import \{ isPastRedeemDeadline \} from "\.\.\/_shared\/claim-redeem\.ts"/);
    expect(source).toMatch(/grace_period_minutes/);
    expect(source).toMatch(/isPastRedeemDeadline\(now\.getTime\(\), String\(claim\.expires_at\), graceMinutes as number\)/);
    // The old nominal comparison must not come back.
    expect(source).not.toMatch(/expiresAt <= now\.getTime\(\)/);
  });

  it("shared deadline semantics: nominal expiry is inside the window, deadline is not", () => {
    const expiresAt = "2026-07-11T18:00:00.000Z";
    const nominal = Date.parse(expiresAt);
    const deadline = redeemDeadlineMs(expiresAt, 10);
    expect(deadline - nominal).toBe(10 * 60 * 1000);
    // At nominal expiry and one ms before the deadline the claim is still
    // redeemable — claim-deal/release-claim must not expire it.
    expect(isPastRedeemDeadline(nominal, expiresAt, 10)).toBe(false);
    expect(isPastRedeemDeadline(deadline - 1, expiresAt, 10)).toBe(false);
    // At the deadline it is over everywhere, atomically.
    expect(isPastRedeemDeadline(deadline, expiresAt, 10)).toBe(true);
  });

  it("shared deadline semantics: missing/invalid grace falls back to 10 minutes", () => {
    const expiresAt = "2026-07-11T18:00:00.000Z";
    const withDefault = redeemDeadlineMs(expiresAt, Number.NaN);
    expect(withDefault).toBe(redeemDeadlineMs(expiresAt, 10));
    expect(redeemDeadlineMs(expiresAt, 0)).toBe(withDefault);
    expect(redeemDeadlineMs(expiresAt, -5)).toBe(withDefault);
  });
});
