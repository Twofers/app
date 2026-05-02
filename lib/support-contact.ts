/**
 * Single source of truth for the support email/phone the in-app "Help" row uses.
 *
 * Override at build time without touching code by setting:
 *   EXPO_PUBLIC_SUPPORT_EMAIL=help@yourcafeapp.com
 *   EXPO_PUBLIC_SUPPORT_PHONE=+12145551234   (optional)
 *
 * The defaults below are placeholders — verify they actually receive mail before
 * the pilot, OR set the env vars above. A bouncing support address is worse than
 * no contact at all because pilot cafes will think you're ignoring them.
 */
const DEFAULT_SUPPORT_EMAIL = "support@twoferapp.com";

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

export function getSupportEmail(): string {
  return readEnv("EXPO_PUBLIC_SUPPORT_EMAIL") ?? DEFAULT_SUPPORT_EMAIL;
}

/** Returns null when no phone is configured — the UI hides the phone row in that case. */
export function getSupportPhone(): string | null {
  return readEnv("EXPO_PUBLIC_SUPPORT_PHONE");
}
