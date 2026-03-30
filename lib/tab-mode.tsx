import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { fetchAppTabModeForUser, upsertAppTabModeForUser } from "@/lib/profiles-app-mode";

/** Primary store (cleared on uninstall; avoids iOS Keychain “ghost” state after reinstall). */
export const TAB_MODE_ASYNC_KEY = "twoforone_tab_mode_v2";
/** Auth screen uses this to know if user has intentionally chosen a role before. */
export const TAB_MODE_ROLE_COMMITTED_KEY = "twoforone_role_committed_v1";
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
  const asyncVal = await AsyncStorage.getItem(TAB_MODE_ASYNC_KEY);
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
      await AsyncStorage.setItem(TAB_MODE_ASYNC_KEY, legacy);
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

  const after = await AsyncStorage.getItem(TAB_MODE_ASYNC_KEY);
  if (after === "business" || after === "customer") return after;
  return "customer";
}

export function TabModeProvider({ children }: { children: ReactNode }) {
  const { session, isInitialLoading: authLoading } = useAuthSession();
  const [mode, setModeState] = useState<TabMode>("customer");
  const [ready, setReady] = useState(false);
  /** User picked Customer/Business before persisted mode finished loading — do not overwrite their choice. */
  const userChoseModeRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadStoredMode();
        if (!cancelled && !userChoseModeRef.current) {
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

  useEffect(() => {
    if (authLoading) return;
    const uid = session?.user?.id;
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      const remote = await fetchAppTabModeForUser(uid);
      if (!remote || cancelled) return;
      userChoseModeRef.current = true;
      setModeState(remote);
      try {
        await AsyncStorage.setItem(TAB_MODE_ASYNC_KEY, remote);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id]);

  const setMode = useCallback(async (next: TabMode) => {
    userChoseModeRef.current = true;
    setReady(true);
    const prev = mode;
    setModeState(next);
    try {
      await AsyncStorage.setItem(TAB_MODE_ASYNC_KEY, next);
      await AsyncStorage.setItem(TAB_MODE_ROLE_COMMITTED_KEY, "1");
      const uid = session?.user?.id;
      if (uid) {
        await upsertAppTabModeForUser(uid, next);
      }
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
  }, [mode, session?.user?.id]);

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
