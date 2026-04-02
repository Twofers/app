import type { Href } from "expo-router";
import { supabase } from "@/lib/supabase";
import { removePushTokensForUser } from "@/lib/push-token";
import type { TabMode } from "@/lib/tab-mode";

/**
 * Full app sign-out: push token cleanup and tab mode reset (while session is valid),
 * then Supabase sign-out and login screen. Tab mode upsert must run before signOut or
 * the profile write fails while the user is already logged out.
 */
export async function signOutAndRedirectToAuthLanding(params: {
  userId: string | null | undefined;
  setTabMode: (next: TabMode) => Promise<void>;
  replace: (href: Href) => void;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { userId, setTabMode, replace } = params;
  try {
    if (userId) {
      await removePushTokensForUser(userId);
    }
    await setTabMode("customer");
    await supabase.auth.signOut();
    replace("/auth-landing" as Href);
    return { ok: true };
  } catch (e: unknown) {
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
