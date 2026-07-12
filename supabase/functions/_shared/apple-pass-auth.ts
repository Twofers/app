/**
 * Native wallet pass — Apple PassKit web-service authentication token.
 *
 * The token is baked into the pass at issue time and sent back by the device on
 * every web-service call. It must stay STABLE across pass re-issues (the device
 * keeps the token from when the pass was added). We derive it deterministically
 * as HMAC-SHA256(serverSecret, "wallet-pass:<userId>") so it is stable and
 * reconstructible without storing the raw token anywhere. Uses WebCrypto only,
 * so the vitest suite exercises it directly.
 */

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

/** Stable per-user PassKit authentication token (43-char base64url, > Apple's 16 min). */
export async function deriveAppleAuthToken(serverSecret: string, userId: string): Promise<string> {
  return base64Url(await hmacSha256(serverSecret, `wallet-pass:${userId}`));
}

/** SHA-256 (base64url) of the token — stored in wallet_passes.apple_auth_token_hash for observability. */
export async function appleAuthTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64Url(new Uint8Array(digest));
}

/** Constant-time-ish comparison of the presented token against the derived one. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Parses `Authorization: ApplePass <token>` → the token, or null. */
export function parseApplePassAuthHeader(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^ApplePass\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
