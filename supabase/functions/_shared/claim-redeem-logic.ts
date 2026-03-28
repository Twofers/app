/** Pure logic extracted from claim-redeem.ts for testability outside Deno. */

export function redeemDeadlineMs(expiresAtIso: string, graceMinutes: number): number {
  const g = Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : 10;
  return new Date(expiresAtIso).getTime() + g * 60 * 1000;
}

export function isPastRedeemDeadline(
  nowMs: number,
  expiresAtIso: string,
  graceMinutes: number,
): boolean {
  return nowMs >= redeemDeadlineMs(expiresAtIso, graceMinutes);
}

export const VISUAL_REDEEM_AUTO_FINALIZE_MS = 30_000;
