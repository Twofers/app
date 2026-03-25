import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";

/** Primary store (cleared on uninstall; avoids iOS Keychain “ghost” state after reinstall). */
const ASYNC_KEY = "twoforone_tab_mode_v2";
/** Legacy SecureStore key from earlier builds. */
const LEGACY_SECURE_KEY = "twoforone_tab_mode";

export type TabMode = "customer" | "business";

type TabModeContextValue = {
  mode: TabMode;
  setMode: (next: TabMode) => Promise<void>;
  ready: boolean;
};

const TabModeContext = createContext<TabModeContextValue | null>(null);

async function loadStoredMode(): Promise<TabMode> {
  const asyncVal = await AsyncStorage.getItem(ASYNC_KEY);
  if (asyncVal === "business" || asyncVal === "customer") {
    return asyncVal;
  }

  const keys = await AsyncStorage.getAllKeys();
  const hasConsumerData = keys.some((k) => k.startsWith("twoforone_consumer_v1_"));
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const trustLegacySecure = hasConsumerData || !!session?.user;

  if (!trustLegacySecure) {
    try {
      await SecureStore.deleteItemAsync(LEGACY_SECURE_KEY);
    } catch {
      /* missing */
    }
    return "customer";
  }

  const legacy = await SecureStore.getItemAsync(LEGACY_SECURE_KEY);
  if (legacy === "business" || legacy === "customer") {
    await AsyncStorage.setItem(ASYNC_KEY, legacy);
    try {
      await SecureStore.deleteItemAsync(LEGACY_SECURE_KEY);
    } catch {
      /* missing */
    }
    return legacy;
  }

  return "customer";
}

export function TabModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<TabMode>("customer");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadStoredMode();
        if (!cancelled) {
          setModeState(stored);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback(async (next: TabMode) => {
    setModeState(next);
    await AsyncStorage.setItem(ASYNC_KEY, next);
    try {
      await SecureStore.deleteItemAsync(LEGACY_SECURE_KEY);
    } catch {
      /* missing */
    }
  }, []);

  const value = useMemo(() => ({ mode, setMode, ready }), [mode, setMode, ready]);

  return <TabModeContext.Provider value={value}>{children}</TabModeContext.Provider>;
}

export function useTabMode(): TabModeContextValue {
  const ctx = useContext(TabModeContext);
  if (!ctx) {
    throw new Error("useTabMode must be used within TabModeProvider");
  }
  return ctx;
}
