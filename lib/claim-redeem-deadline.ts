/** Redeem is allowed until claim `expires_at` + grace (server + client must match). */
export const DEFAULT_CLAIM_GRACE_MINUTES = 10;

export function getClaimRedeemDeadlineMs(
  expiresAtIso: string,
  graceMinutes: number = DEFAULT_CLAIM_GRACE_MINUTES,
): number {
  const t = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(t)) return 0;
  return t + graceMinutes * 60 * 1000;
}

export function isPastClaimRedeemDeadline(
  expiresAtIso: string,
  nowMs: number,
  graceMinutes: number = DEFAULT_CLAIM_GRACE_MINUTES,
): boolean {
  return nowMs >= getClaimRedeemDeadlineMs(expiresAtIso, graceMinutes);
}

/** ISO timestamp for display (countdown / copy). */
export function getClaimRedeemDeadlineIso(
  expiresAtIso: string,
  graceMinutes: number = DEFAULT_CLAIM_GRACE_MINUTES,
): string {
  return new Date(getClaimRedeemDeadlineMs(expiresAtIso, graceMinutes)).toISOString();
}
