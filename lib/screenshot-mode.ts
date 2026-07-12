import { LaunchArguments } from "react-native-launch-arguments";
import type { Session, User } from "@supabase/supabase-js";

/**
 * App Store screenshot seeding.
 *
 * When the app is launched from the ScreenshotTests UI test with the launch
 * argument `-screenshotMode 1`, the app renders deterministic synthetic demo
 * data instead of talking to your dev Supabase instance. This lets the store
 * screenshots be pixel-stable and free of any real user data.
 *
 * SAFETY: this is hard-gated on `__DEV__`. A production / store build has
 * `__DEV__ === false`, so `isScreenshotMode()` can never return true there and
 * none of the fake-session or fixture code can reach real users. The seeded
 * account, deals, and redemption codes below are entirely synthetic — no real
 * PII, no real card numbers, no real account.
 */

type ScreenshotLaunchArgs = {
  screenshotMode?: string | number | boolean;
};

/** Stable synthetic ids so fixtures cross-reference deterministically. */
export const SCREENSHOT_USER_ID = "00000000-0000-4000-8000-000000000001";

let cached: boolean | null = null;

export function isScreenshotMode(): boolean {
  if (cached !== null) return cached;
  // Dev-only. Never honor the flag in a release/store build.
  if (!__DEV__) {
    cached = false;
    return cached;
  }
  try {
    const args = LaunchArguments.value<ScreenshotLaunchArgs>();
    const raw = args?.screenshotMode;
    cached = raw === "1" || raw === 1 || raw === true;
  } catch {
    // Native module missing (e.g. running before a fresh prebuild) — treat as off.
    cached = false;
  }
  return cached;
}

/**
 * A fully synthetic authenticated session used to skip the real login flow in
 * screenshot mode. The tokens are obviously fake and are never sent to a real
 * backend — `supabaseFetch` short-circuits every request to local fixtures when
 * screenshot mode is on.
 */
export function buildScreenshotSession(): Session {
  const nowSec = Math.floor(Date.now() / 1000);
  const epochIso = new Date(0).toISOString();
  const user = {
    id: SCREENSHOT_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "demo.shopper@screenshots.twoferapp.com",
    email_confirmed_at: epochIso,
    phone: "",
    confirmed_at: epochIso,
    last_sign_in_at: epochIso,
    created_at: epochIso,
    updated_at: epochIso,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { role: "customer", display_name: "Demo Shopper" },
    identities: [],
  } as unknown as User;

  return {
    access_token: "screenshot-mode-fake-access-token",
    refresh_token: "screenshot-mode-fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSec + 3600,
    user,
  } as Session;
}
