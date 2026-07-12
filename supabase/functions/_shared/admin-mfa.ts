// Admin MFA (TOTP) helpers shared by admin-auth-session and every admin
// edge function that must enforce admin_users.require_mfa.
//
// Supabase GoTrue embeds the session's Authenticator Assurance Level as an
// `aal` claim ("aal1" | "aal2") directly in the access token JWT payload, and
// returns enrolled MFA factors on the `user.factors` array from
// `auth.getUser()`. We decode the already-verified access token (verified by
// the prior `auth.getUser()` call against Supabase's own signing keys) rather
// than re-implement JWT signature verification here.

export type AdminAuthFactor = {
  id: string;
  factor_type: string;
  status: string;
};

function base64UrlToBase64(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  return padded + "=".repeat(padLength);
}

export function decodeJwtAal(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return null;
    const payloadJson = atob(base64UrlToBase64(parts[1]));
    const payload = JSON.parse(payloadJson) as { aal?: unknown };
    return typeof payload.aal === "string" ? payload.aal : null;
  } catch {
    return null;
  }
}

export function verifiedTotpFactor(
  factors: unknown,
): AdminAuthFactor | null {
  if (!Array.isArray(factors)) return null;
  const match = factors.find(
    (factor): factor is AdminAuthFactor =>
      Boolean(factor) &&
      typeof factor === "object" &&
      (factor as AdminAuthFactor).factor_type === "totp" &&
      (factor as AdminAuthFactor).status === "verified",
  );
  return match ?? null;
}

export function isAal2(accessToken: string): boolean {
  return decodeJwtAal(accessToken) === "aal2";
}
