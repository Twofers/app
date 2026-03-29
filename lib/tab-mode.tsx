import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/** Primary store (cleared on uninstall; avoids iOS Keychain “ghost” state after reinstall). */
const ASYNC_KEY = "twoforone_tab_mode_v2";
/** Legacy SecureStore key from earlier builds. */
const LEGACY_SECURE_KEY = "twoforone_tab_mode";
/**
 * SecureStore flag: once set, we never copy legacy tab mode into AsyncStorage again.
 * Survives iOS Keychain across reinstall (like auth), so an empty AsyncStorage + this flag means “fresh UX” → customer.
 */
const LEGACY_IMPORT_DONE_SECURE_KEY = "twoforone_tab_mode_legacy_import_done";

export type TabMode = "customer" | "business";

type TabModeContextValue = {
  mode: TabMode;
  setMode: (next: TabMode) => Promise<void>;
  ready: boolean;
};

const TabModeContext = createContext<TabModeContextValue | null>(null);

async function loadStoredMode(): Promise<TabMode> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const qpMode = new URLSearchParams(window.location.search).get("mode");
    if (qpMode === "business" || qpMode === "customer") {
      return qpMode;
    }
  }

  const asyncVal = await AsyncStorage.getItem(ASYNC_KEY);
  if (asyncVal === "business" || asyncVal === "customer") {
    return asyncVal;
  }

  try {
    if (Platform.OS === "web") {
      // Legacy SecureStore migration does not apply on web.
      return "customer";
    }
    const SecureStore = await import("expo-secure-store");
    const importDone = await SecureStore.getItemAsync(LEGACY_IMPORT_DONE_SECURE_KEY);
    if (importDone === "1") {
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
    }
    await SecureStore.setItemAsync(LEGACY_IMPORT_DONE_SECURE_KEY, "1");
  } catch {
    /* SecureStore unavailable */
  }

  const after = await AsyncStorage.getItem(ASYNC_KEY);
  if (after === "business" || after === "customer") return after;
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
    const prev = mode;
    setModeState(next);
    try {
      await AsyncStorage.setItem(ASYNC_KEY, next);
    } catch (e) {
      setModeState(prev);
      if (__DEV__) {
        console.warn("[tab-mode] AsyncStorage.setItem failed; reverted mode", e);
      }
      throw e;
    }
    try {
      if (Platform.OS !== "web") {
        const SecureStore = await import("expo-secure-store");
        await SecureStore.deleteItemAsync(LEGACY_SECURE_KEY);
      }
    } catch (e) {
      if (__DEV__) {
        console.warn("[tab-mode] SecureStore legacy key cleanup failed", e);
      }
    }
  }, [mode]);

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
