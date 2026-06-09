/**
 * Single source of truth for the support email/phone the in-app Help row uses.
 *
 * The public support email is fixed so app and website contact actions stay aligned.
 * Phone support remains optional and can be enabled by adding an env var to the build:
 *   EXPO_PUBLIC_SUPPORT_PHONE=+12145551234
 */
export const SUPPORT_EMAIL = "support@twoferapp.com";

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

/** Returns the public support email used by in-app contact actions. */
export function getSupportEmail(): string {
  return SUPPORT_EMAIL;
}

/** Returns null when no phone is configured, so the UI hides the phone row. */
export function getSupportPhone(): string | null {
  return readEnv("EXPO_PUBLIC_SUPPORT_PHONE");
}
