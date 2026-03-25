import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

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
  const asyncVal = await AsyncStorage.getItem(ASYNC_KEY);
  if (asyncVal === "business" || asyncVal === "customer") {
    return asyncVal;
  }

  try {
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
