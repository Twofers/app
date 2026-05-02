/**
 * Single source of truth for the support email/phone the in-app "Help" row uses.
 *
 * Both fields are opt-in. The Settings tab hides the entire Help & Contact section
 * when neither is configured, so a project that wants to handle pilot support
 * out-of-band (texting cafes directly, etc.) ships without a dead-link row.
 *
 * Set when ready by adding env vars to your build:
 *   EXPO_PUBLIC_SUPPORT_EMAIL=help@yourcafeapp.com
 *   EXPO_PUBLIC_SUPPORT_PHONE=+12145551234
 *
 * The row reappears automatically on the next build — no code change needed.
 */
function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

/** Returns null when no email is configured — the UI hides the email row in that case. */
export function getSupportEmail(): string | null {
  return readEnv("EXPO_PUBLIC_SUPPORT_EMAIL");
}

/** Returns null when no phone is configured — the UI hides the phone row in that case. */
export function getSupportPhone(): string | null {
  return readEnv("EXPO_PUBLIC_SUPPORT_PHONE");
}
