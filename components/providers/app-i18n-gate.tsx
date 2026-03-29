import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import i18n from "@/lib/i18n/config";
import { hydrateUiLocale } from "@/lib/locale/ui-locale-storage";

/**
 * Hydrates persisted / device UI language before showing localized routes.
 * English renders first in i18n config; we switch before first meaningful paint.
 */
export function AppI18nGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const locale = await hydrateUiLocale();
        await i18n.changeLanguage(locale);
      } catch (e) {
        if (__DEV__) console.warn("AppI18nGate: locale hydrate failed", e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Hide native splash only after React commits the real app shell (avoids blank / “stuck” splash on Android). */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        void SplashScreen.hideAsync().catch(() => {});
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [ready]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return <>{children}</>;
}
