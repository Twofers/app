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
import { useAuthSession } from "@/components/providers/auth-session-provider";

/**
 * Hard role split (spec section 4, item 2): the account role is picked once at
 * signup, stored in `profiles.role`, and never changes. This provider only
 * mirrors that stored role for routing — there is no in-app switching.
 */

/** Local cache of the last resolved role so cold boots route without a network read. */
export const TAB_MODE_ASYNC_KEY = "twoforone_tab_mode_v2";

export type TabMode = "customer" | "business";

type TabModeContextValue = {
  /** Resolved account role; defaults to "customer" until known. */
  mode: TabMode;
  /** Set after login/signup once the role is resolved, so routing doesn't wait for the remote fetch. */
  adoptRole: (role: TabMode) => Promise<void>;
  ready: boolean;
};

const TabModeContext = createContext<TabModeContextValue | null>(null);

async function loadCachedRole(): Promise<TabMode | null> {
  try {
    const cached = await AsyncStorage.getItem(TAB_MODE_ASYNC_KEY);
    if (cached === "business" || cached === "customer") return cached;
  } catch {
    /* noop */
  }
  return null;
}

export async function clearCachedRole(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TAB_MODE_ASYNC_KEY);
  } catch {
    /* noop */
  }
}

export function TabModeProvider({ children }: { children: ReactNode }) {
  const { session, isInitialLoading: authLoading } = useAuthSession();
  const [mode, setModeState] = useState<TabMode>("customer");
  const [ready, setReady] = useState(false);
  /** Bumped by adoptRole so an in-flight remote resolve can't overwrite a fresher local result. */
  const localChangeEpochRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await loadCachedRole();
      if (!cancelled && cached && localChangeEpochRef.current === 0) {
        setModeState(cached);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Signed out: revert to the default so the next account starts clean.
  useEffect(() => {
    if (authLoading || session?.user) return;
    setModeState("customer");
  }, [authLoading, session?.user]);

  // Signed in: resolve the permanent role from the profile (with derive fallback).
  useEffect(() => {
    if (authLoading) return;
    const user = session?.user;
    if (!user) return;
    if ((user.app_metadata as Record<string, unknown> | undefined)?.app_role === "redeemer") {
      setModeState("business");
      setReady(true);
      return;
    }
    let cancelled = false;
    const epochAtStart = localChangeEpochRef.current;
    void (async () => {
      const { resolveRoleForUser } = await import("@/lib/profiles-role");
      const role = await resolveRoleForUser(user);
      if (cancelled || localChangeEpochRef.current !== epochAtStart) return;
      setModeState(role);
      try {
        await AsyncStorage.setItem(TAB_MODE_ASYNC_KEY, role);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user]);

  const adoptRole = useCallback(async (role: TabMode) => {
    localChangeEpochRef.current += 1;
    setModeState(role);
    setReady(true);
    try {
      await AsyncStorage.setItem(TAB_MODE_ASYNC_KEY, role);
    } catch {
      /* cache only; the stored profile role remains authoritative */
    }
  }, []);

  const value = useMemo(() => ({ mode, adoptRole, ready }), [mode, adoptRole, ready]);

  return <TabModeContext.Provider value={value}>{children}</TabModeContext.Provider>;
}

export function useTabMode(): TabModeContextValue {
  const ctx = useContext(TabModeContext);
  if (!ctx) {
    throw new Error("useTabMode must be used within TabModeProvider");
  }
  return ctx;
}
