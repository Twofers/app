import type { Href } from "expo-router";
import { supabase } from "@/lib/supabase";
import { removePushTokensForUser } from "@/lib/push-token";
import { clearLocalAuthSessionState } from "./auth-local-session-state";
import { clearUserInitiatedSignOut, markUserInitiatedSignOut } from "./auth-sign-out-intent";

/**
 * Full app sign-out: push token cleanup (while session is valid), local
 * auth-scoped cache cleanup, then Supabase sign-out and login screen.
 *
 * The stored profile role is permanent (hard role split) and is NOT touched
 * here. Cleanup steps are best-effort: failures are logged but sign-out
 * always proceeds.
 *
 * The sign-out is flagged as user-initiated first so AuthStackGate leaves the
 * redirect to us: its own redirect would pin the screen being signed out from as
 * the post-login destination, and the next login would land there instead of home.
 */
export async function signOutAndRedirectToAuthLanding(params: {
  userId: string | null | undefined;
  replace: (href: Href) => void;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { userId, replace } = params;
  markUserInitiatedSignOut();
  try {
    // Best-effort: remove push tokens (don't block sign-out on failure)
    if (userId) {
      await removePushTokensForUser(userId).catch((e) => {
        if (__DEV__) console.warn("[sign-out] removePushTokens failed:", e);
      });
    }

    // Best-effort: drop local auth-scoped state so the next account resolves fresh.
    await clearLocalAuthSessionState();

    // This is the critical step — always attempt sign-out
    await supabase.auth.signOut({ scope: "local" });
    replace("/auth-landing" as Href);
    return { ok: true };
  } catch (e: unknown) {
    // Sign-out did not reach the login screen: hand routing back to AuthStackGate
    // so a half-cleared session cannot strand the user on a protected screen.
    clearUserInitiatedSignOut();
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
            ? (e as { message: string }).message
            : "Sign out failed";
    return { ok: false, message: message || "Sign out failed" };
  }
}
