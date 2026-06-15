type SessionLike = {
  user?: {
    app_metadata?: Record<string, unknown> | null;
  } | null;
} | null | undefined;

export const REDEMPTION_SHORT_CODE_LENGTH = 6;

export function normalizeRedemptionCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, REDEMPTION_SHORT_CODE_LENGTH);
}

export function isRedemptionCodeComplete(raw: string): boolean {
  return normalizeRedemptionCode(raw).length === REDEMPTION_SHORT_CODE_LENGTH;
}

export function isRedeemerSessionLike(session: SessionLike): boolean {
  const metadata = session?.user?.app_metadata;
  return metadata?.app_role === "redeemer";
}
