import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Appearance, Platform, useColorScheme as useNativeColorScheme, View } from "react-native";
import * as SystemUI from "expo-system-ui";
import * as NavigationBar from "expo-navigation-bar";

import { Colors } from "@/constants/theme";
import {
  hydrateThemePreference,
  setStoredThemePreference,
  type ThemePreference,
} from "@/lib/theme-preference";

type AppColorScheme = "light" | "dark";

type AppThemeContextValue = {
  colorScheme: AppColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function resolveColorScheme(preference: ThemePreference, nativeScheme: "light" | "dark" | null | undefined): AppColorScheme {
  if (preference === "light" || preference === "dark") return preference;
  return nativeScheme === "dark" ? "dark" : "light";
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const nativeScheme = useNativeColorScheme();
  const [ready, setReady] = useState(false);
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const colorScheme = resolveColorScheme(preference, nativeScheme);
  const theme = Colors[colorScheme];

  useEffect(() => {
    let cancelled = false;
    void hydrateThemePreference()
      .then((saved) => {
        if (!cancelled) setPreferenceState(saved);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(preference === "system" ? null : preference);
  }, [preference]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background).catch(() => {});
  }, [theme.background]);

  // Android system navigation bar: with edge-to-edge the bar is transparent and
  // the contrast scrim is disabled (app.json androidNavigationBar.enforceContrast
  // = false), so it shows the window background set above. Set the foreground
  // (button/icon) style to follow the APP theme instead of the phone's system
  // theme — otherwise a dark app keeps a light system nav bar. `setStyle`:
  // "dark" = dark bar with light icons, "light" = light bar with dark icons.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    try {
      NavigationBar.setStyle(colorScheme === "dark" ? "dark" : "light");
    } catch {
      // No-op: unsupported on gesture-nav bars / older Android; harmless.
    }
  }, [colorScheme]);

  const setPreference = useCallback(async (nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    try {
      await setStoredThemePreference(nextPreference);
    } catch (error) {
      if (__DEV__) console.warn("[theme] preference save failed", error);
    }
  }, []);

  const value = useMemo(
    () => ({
      colorScheme,
      preference,
      setPreference,
    }),
    [colorScheme, preference, setPreference],
  );

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppColorScheme(): AppColorScheme {
  return useContext(AppThemeContext)?.colorScheme ?? "light";
}

export function useThemePreference() {
  const context = useContext(AppThemeContext);
  if (!context) {
    return {
      colorScheme: "light" as const,
      preference: "system" as const,
      setPreference: async () => {},
    };
  }
  return context;
}
