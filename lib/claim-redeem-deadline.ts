/** Pure deadline logic for claim redemption, testable outside Deno. */

export const DEFAULT_CLAIM_GRACE_MINUTES = 10;

export function getClaimRedeemDeadlineIso(
  expiresAtIso: string,
  graceMinutes: number,
): string {
  const g = Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : DEFAULT_CLAIM_GRACE_MINUTES;
  return new Date(new Date(expiresAtIso).getTime() + g * 60_000).toISOString();
}

export function isPastClaimRedeemDeadline(
  expiresAtIso: string,
  nowMs: number,
  graceMinutes: number,
): boolean {
  const g = Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : DEFAULT_CLAIM_GRACE_MINUTES;
  const deadline = new Date(expiresAtIso).getTime() + g * 60_000;
  return nowMs >= deadline;
}
