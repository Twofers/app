import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { devLog, devWarn } from "@/lib/dev-log";

type NotificationsModule = typeof import("expo-notifications");

let cachedNotifications: NotificationsModule | null = null;
async function getNotifications(): Promise<NotificationsModule | null> {
  // Expo Router uses SSR-like rendering for web; avoid importing notifications there.
  if (Platform.OS === "web" && typeof window === "undefined") return null;
  if (cachedNotifications) return cachedNotifications;
  cachedNotifications = await import("expo-notifications");
  return cachedNotifications;
}

/** Running inside the Expo Go app (store client). Remote push is not supported on Android Expo Go. */
export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/** Dev client / standalone / bare — suitable for full notifications APIs. */
export function isDevelopmentBuildOrStandalone(): boolean {
  const e = Constants.executionEnvironment;
  return e === ExecutionEnvironment.Bare || e === ExecutionEnvironment.Standalone;
}

/**
 * Request notification permission only where it won't throw Expo Go Android errors.
 * In Expo Go on Android, remote push was removed — skip and log once.
 */
export async function requestNotificationPermissionsSafe(): Promise<{
  status: import("expo-notifications").PermissionStatus;
  skippedBecauseExpoGo: boolean;
}> {
  if (isExpoGo() && Platform.OS === "android") {
    devLog(
      "[notifications] Skipping permission request on Android Expo Go (remote push unavailable; use a dev build).",
    );
    return { status: "undetermined" as import("expo-notifications").PermissionStatus, skippedBecauseExpoGo: true };
  }

  try {
    const Notifications = await getNotifications();
    if (!Notifications) {
      return { status: "undetermined" as import("expo-notifications").PermissionStatus, skippedBecauseExpoGo: false };
    }
    const { status } = await Notifications.requestPermissionsAsync();
    return { status, skippedBecauseExpoGo: false };
  } catch (e) {
    devWarn("[notifications] requestPermissionsAsync failed (non-fatal):", e);
    return { status: "undetermined" as import("expo-notifications").PermissionStatus, skippedBecauseExpoGo: false };
  }
}

type ScheduleRequest = Parameters<NotificationsModule["scheduleNotificationAsync"]>[0];

/** Schedule a local notification; no-op in environments where scheduling throws (e.g. some Expo Go cases). */
export async function scheduleLocalNotificationSafe(request: ScheduleRequest): Promise<string | null> {
  if (isExpoGo() && Platform.OS === "android") {
    return null;
  }
  try {
    const Notifications = await getNotifications();
    if (!Notifications) return null;
    // Ensure Android local notifications use the registered channel.
    // When trigger is null (immediate), replace with a ChannelAwareTriggerInput.
    if (Platform.OS === "android" && request.trigger === null) {
      request = { ...request, trigger: { channelId: "deal-alerts" } };
    }
    return await Notifications.scheduleNotificationAsync(request);
  } catch (e) {
    devWarn("[notifications] scheduleNotificationAsync skipped (non-fatal):", e);
    return null;
  }
}
