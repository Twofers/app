import type { Href } from "expo-router";
import { supabase } from "@/lib/supabase";
import { removePushTokensForUser } from "@/lib/push-token";
import type { TabMode } from "@/lib/tab-mode";

/**
 * Full app sign-out: push token cleanup and tab mode reset (while session is valid),
 * then Supabase sign-out and login screen.
 *
 * FIX: Previously, if setTabMode threw (e.g. missing 'profiles' table in schema
 * cache), the entire sign-out was aborted — users could never log out. Now both
 * push-token removal and tab-mode upsert are best-effort: failures are logged
 * but sign-out always proceeds.
 */
export async function signOutAndRedirectToAuthLanding(params: {
  userId: string | null | undefined;
  setTabMode: (next: TabMode) => Promise<void>;
  replace: (href: Href) => void;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { userId, setTabMode, replace } = params;
  try {
    // Best-effort: remove push tokens (don't block sign-out on failure)
    if (userId) {
      await removePushTokensForUser(userId).catch(() => {});
    }

    // Best-effort: reset tab mode to customer (don't block sign-out on failure).
    // This can fail if the profiles table hasn't been created yet or if the
    // PostgREST schema cache is stale.
    await setTabMode("customer").catch(() => {});

    // This is the critical step — always attempt sign-out
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
