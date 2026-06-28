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
import {
  decodeCachedRole,
  encodeCachedRole,
  isLegacyCachedRole,
  TAB_MODE_ASYNC_KEY,
  type CachedTabModeRole,
} from "@/lib/tab-mode-cache";

/**
 * Hard role split (spec section 4, item 2): the account role is picked once at
 * signup, stored in `profiles.role`, and never changes. This provider only
 * mirrors that stored role for routing — there is no in-app switching.
 */

export { TAB_MODE_ASYNC_KEY } from "@/lib/tab-mode-cache";

export type TabMode = CachedTabModeRole;

type TabModeContextValue = {
  /** Resolved account role; defaults to "customer" until known. */
  mode: TabMode;
  /** Set after login/signup once the role is resolved, so routing doesn't wait for the remote fetch. */
  adoptRole: (role: TabMode, userId?: string) => Promise<void>;
  ready: boolean;
};

const TabModeContext = createContext<TabModeContextValue | null>(null);

async function loadCachedRole(userId: string): Promise<TabMode | null> {
  try {
    const cached = await AsyncStorage.getItem(TAB_MODE_ASYNC_KEY);
    const scopedRole = decodeCachedRole(cached, userId);
    if (scopedRole) return scopedRole;
    if (isLegacyCachedRole(cached)) {
      await AsyncStorage.removeItem(TAB_MODE_ASYNC_KEY);
    }
  } catch {
    /* noop */
  }
  return null;
}

async function saveCachedRole(userId: string, role: TabMode): Promise<void> {
  try {
    await AsyncStorage.setItem(TAB_MODE_ASYNC_KEY, encodeCachedRole(userId, role));
  } catch {
    /* cache only; the stored profile role remains authoritative */
  }
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
    const user = session?.user;
    if (authLoading) {
      setReady(false);
      return;
    }
    if (!user) {
      setModeState("customer");
      setReady(true);
      return;
    }

    let cancelled = false;
    const epochAtStart = localChangeEpochRef.current;
    setReady(false);

    void (async () => {
      if ((user.app_metadata as Record<string, unknown> | undefined)?.app_role === "redeemer") {
        if (!cancelled && localChangeEpochRef.current === epochAtStart) {
          setModeState("business");
          setReady(true);
          await saveCachedRole(user.id, "business");
        }
        return;
      }

      const cached = await loadCachedRole(user.id);
      if (!cancelled && cached && localChangeEpochRef.current === epochAtStart) {
        setModeState(cached);
        setReady(true);
      }

      const { resolveRoleForUser } = await import("@/lib/profiles-role");
      const role = await resolveRoleForUser(user);
      if (cancelled || localChangeEpochRef.current !== epochAtStart) return;
      setModeState(role);
      setReady(true);
      await saveCachedRole(user.id, role);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user]);

  const adoptRole = useCallback(
    async (role: TabMode, userId?: string) => {
      localChangeEpochRef.current += 1;
      setModeState(role);
      setReady(true);
      const cacheUserId = userId ?? session?.user?.id;
      if (cacheUserId) await saveCachedRole(cacheUserId, role);
    },
    [session?.user?.id],
  );

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
