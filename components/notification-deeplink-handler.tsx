import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter, type Href } from "expo-router";
import { devWarn } from "@/lib/dev-log";

/**
 * Allowlist of routes a notification payload may navigate to. Without this allowlist a
 * compromised or test push could route to internal screens (`/debug-diagnostics`,
 * `/(tabs)/billing`, etc.) by setting `data.path` arbitrarily.
 */
const ALLOWED_PATH_PATTERNS: ReadonlyArray<RegExp> = [
  /^\/deal\/[A-Za-z0-9_-]+$/,
  /^\/business\/[A-Za-z0-9_-]+$/,
  /^\/\(tabs\)$/,
  /^\/\(tabs\)\/(index|wallet|map|settings|dashboard|create)$/,
];

function isAllowedPath(p: string): boolean {
  return ALLOWED_PATH_PATTERNS.some((re) => re.test(p));
}

function readPath(data: Record<string, unknown> | undefined): Href | null {
  if (!data) return null;
  const path = data.path;
  if (typeof path === "string" && path.startsWith("/") && isAllowedPath(path)) {
    return path as Href;
  }
  const dealId = data.dealId;
  if (typeof dealId === "string" && /^[A-Za-z0-9_-]+$/.test(dealId)) {
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

    // N-3 FIX: The previous async `.then()` pattern created a race condition
    // where the cleanup function could run before the subscription was assigned.
    // Use a `cancelled` flag so the async callback skips setup if already unmounted.
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;

    const navigate = (data: Record<string, unknown> | undefined) => {
      const href = readPath(data);
      if (href) router.push(href);
    };

    void import("expo-notifications")
      .then((Notifications) => {
        if (cancelled) return;

        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          navigate(response.notification.request.content.data as Record<string, unknown> | undefined);
        });

        if (!coldStartHandled.current) {
          coldStartHandled.current = true;
          void Notifications.getLastNotificationResponseAsync()
            .then((response) => {
              if (!response || cancelled) return;
              navigate(response.notification.request.content.data as Record<string, unknown> | undefined);
            })
            .catch((e) => {
              devWarn("[notifications] getLastNotificationResponseAsync failed (non-fatal):", e);
            });
        }
      })
      .catch((e) => {
        devWarn("[notifications] Deep link listener setup skipped (non-fatal):", e);
      });

    return () => {
      cancelled = true;
      try {
        subscription?.remove();
      } catch {
        /* ignore */
      }
    };
  }, [router]);

  return null;
}
