type SessionLike = {
  user?: {
    app_metadata?: Record<string, unknown> | null;
  } | null;
} | null | undefined;

export function normalizeRedemptionCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isRedeemerSessionLike(session: SessionLike): boolean {
  const metadata = session?.user?.app_metadata;
  return metadata?.app_role === "redeemer";
}
