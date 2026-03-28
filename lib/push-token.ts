import { Platform } from "react-native";
import {
  isExpoGo,
  isDevelopmentBuildOrStandalone,
} from "./expo-notifications-support";
import { supabase } from "./supabase";
import { devLog, devWarn } from "@/lib/dev-log";

let lastRegisteredToken: string | null = null;

/**
 * Register for Expo push notifications and store the token in Supabase.
 * Safe to call on every app launch — deduplicates via upsert and local cache.
 *
 * Returns the token string if registered, null if skipped or failed.
 */
export async function registerPushTokenIfNeeded(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  if (Platform.OS === "web") return null;
  if (isExpoGo() && Platform.OS === "android") {
    devLog("[push-token] Skipped: Android Expo Go does not support remote push.");
    return null;
  }

  try {
    const Notifications = await import("expo-notifications");
    const Constants = await import("expo-constants");

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus !== "granted") return null;

    const projectId = Constants.default.expirationDate
      ? undefined
      : Constants.default.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: projectId ?? undefined,
    });

    const token = tokenData.data;
    if (!token || token === lastRegisteredToken) return token ?? null;

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
      devWarn("[push-token] Failed to store push token:", error.message);
    } else {
      lastRegisteredToken = token;
    }

    return token;
  } catch (err) {
    devWarn("[push-token] Registration failed (non-fatal):", err);
    return null;
  }
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
