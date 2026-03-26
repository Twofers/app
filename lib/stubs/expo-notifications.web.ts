/**
 * Web stub for `expo-notifications`.
 *
 * Expo Router may execute modules during SSR-like rendering on web. The real
 * `expo-notifications` module expects browser APIs and can crash the dev server.
 *
 * This stub keeps imports safe and makes all notification calls no-ops.
 */

export type PermissionStatus = "granted" | "denied" | "undetermined";

export type NotificationResponse = {
  notification: {
    request: {
      content: {
        data: unknown;
      };
    };
  };
};

export type Subscription = { remove: () => void };

export async function requestPermissionsAsync(): Promise<{ status: PermissionStatus }> {
  return { status: "undetermined" };
}

export async function scheduleNotificationAsync(): Promise<string> {
  return "web-stub";
}

export function addNotificationResponseReceivedListener(): Subscription {
  return { remove() {} };
}

export async function getLastNotificationResponseAsync(): Promise<NotificationResponse | null> {
  return null;
}

