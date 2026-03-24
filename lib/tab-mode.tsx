import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";

const KEY = "twoforone_tab_mode";

export type TabMode = "customer" | "business";

type TabModeContextValue = {
  mode: TabMode;
  setMode: (next: TabMode) => Promise<void>;
  ready: boolean;
};

const TabModeContext = createContext<TabModeContextValue | null>(null);

export function TabModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<TabMode>("customer");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(KEY);
        if (!cancelled && (stored === "business" || stored === "customer")) {
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
    await SecureStore.setItemAsync(KEY, next);
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
