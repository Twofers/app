/**
 * Single source of truth for the support email/phone the in-app Help row uses.
 *
 * The public support email is fixed so app and website contact actions stay aligned.
 * Phone support remains optional and can be enabled by adding an env var to the build:
 *   EXPO_PUBLIC_SUPPORT_PHONE=+12145551234
 */
export const SUPPORT_EMAIL = "support@twoferapp.com";

/** Returns the public support email used by in-app contact actions. */
export function getSupportEmail(): string {
  return SUPPORT_EMAIL;
}

/** Returns null when no phone is configured, so the UI hides the phone row. */
export function getSupportPhone(): string | null {
  // Must be a static property access: Metro only inlines EXPO_PUBLIC_* vars
  // written literally, so process.env[name] is always undefined in builds.
  const v = process.env.EXPO_PUBLIC_SUPPORT_PHONE;
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}
