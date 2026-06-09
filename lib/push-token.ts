import { Platform } from "react-native";
import {
  isExpoGo,
  isDevelopmentBuildOrStandalone,
} from "./expo-notifications-support";
import { supabase } from "./supabase";
import { devLog, devWarn } from "@/lib/dev-log";

let lastRegisteredToken: string | null = null;

export const PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE =
  "We couldn't turn on deal alerts because this device did not finish push setup. Check your connection and try again.";

export type PushTokenRegistrationResult =
  | { ok: true; token: string | null }
  | {
      ok: false;
      reason:
        | "missing-user"
        | "permission-not-granted"
        | "token-unavailable"
        | "store-failed"
        | "registration-failed";
    };

/**
 * Register for Expo push notifications and store the token in Supabase.
 * Safe to call on every app launch — deduplicates via upsert and local cache.
 *
 * Returns structured status for user-facing alert opt-in flows.
 */
export async function registerPushTokenWithResult(userId: string | null): Promise<PushTokenRegistrationResult> {
  if (!userId) return { ok: false, reason: "missing-user" };
  if (Platform.OS === "web") return { ok: true, token: null };
  if (isExpoGo() && Platform.OS === "android") {
    devLog("[push-token] Skipped: Android Expo Go does not support remote push.");
    return { ok: true, token: null };
  }

  try {
    const Notifications = await import("expo-notifications");
    const Constants = await import("expo-constants");

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus !== "granted") return { ok: false, reason: "permission-not-granted" };

    const projectId = Constants.default.expirationDate
      ? undefined
      : Constants.default.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: projectId ?? undefined,
    });

    const token = tokenData.data;
    if (!token) return { ok: false, reason: "token-unavailable" };
    if (token === lastRegisteredToken) return { ok: true, token };

    const platform = Platform.OS;
    const { error } = await supabase.from("push_tokens").upsert(
      {
        user_id: userId,
        expo_push_token: token,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,expo_push_token" },
    );

    if (error) {
      devWarn("[push-token] Failed to store push token.");
      return { ok: false, reason: "store-failed" };
    } else {
      lastRegisteredToken = token;
    }

    return { ok: true, token };
  } catch {
    devWarn("[push-token] Registration failed (non-fatal).");
    return { ok: false, reason: "registration-failed" };
  }
}

/**
 * Backward-compatible helper for background registration paths.
 * Call `registerPushTokenWithResult` from user-facing alert opt-in flows.
 */
export async function registerPushTokenIfNeeded(userId: string | null): Promise<string | null> {
  const result = await registerPushTokenWithResult(userId);
  return result.ok ? result.token : null;
}

/** Remove all push tokens for the current user (call on sign-out). */
export async function removePushTokensForUser(userId: string): Promise<void> {
  try {
    await supabase.from("push_tokens").delete().eq("user_id", userId);
    lastRegisteredToken = null;
  } catch {
    /* best effort */
  }
}
