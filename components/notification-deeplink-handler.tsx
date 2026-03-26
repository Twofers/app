import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter, type Href } from "expo-router";

function readPath(data: Record<string, unknown> | undefined): Href | null {
  if (!data) return null;
  const path = data.path;
  if (typeof path === "string" && path.startsWith("/")) {
    return path as Href;
  }
  const dealId = data.dealId;
  if (typeof dealId === "string" && dealId.length > 0) {
    return `/deal/${dealId}` as Href;
  }
  return null;
}

/**
 * Opens in-app routes when the user taps a notification (foreground/background) or cold-starts from one.
 */
export function NotificationDeepLinkHandler() {
  const router = useRouter();
  const coldStartHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web" && typeof window === "undefined") {
      // Avoid SSR crashes: expo-notifications expects browser APIs.
      return;
    }
    let subscription: { remove: () => void } | null = null;
    try {
      const navigate = (data: Record<string, unknown> | undefined) => {
        const href = readPath(data);
        if (href) router.push(href);
      };

      void import("expo-notifications").then((Notifications) => {
        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          navigate(response.notification.request.content.data as Record<string, unknown> | undefined);
        });

        if (!coldStartHandled.current) {
          coldStartHandled.current = true;
          void Notifications.getLastNotificationResponseAsync()
            .then((response) => {
              if (!response) return;
              navigate(response.notification.request.content.data as Record<string, unknown> | undefined);
            })
            .catch((e) => {
              console.warn("[notifications] getLastNotificationResponseAsync failed (non-fatal):", e);
            });
        }
      });
    } catch (e) {
      console.warn("[notifications] Deep link listener setup skipped (non-fatal):", e);
    }

    return () => {
      try {
        subscription?.remove();
      } catch {
        /* ignore */
      }
    };
  }, [router]);

  return null;
}
