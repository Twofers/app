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
        if (cancelled) return;
        setReady(true);
        try {
          await SplashScreen.hideAsync();
        } catch {
          // Native splash may already be hidden; continue rendering app shell.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
