import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSegments, type Href } from "expo-router";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import {
  ensureRedemptionModeSessionOnBoot,
  forceClearRedemptionModeAndSignOut,
  isRedeemerSession,
  loadRedemptionModeState,
  type RedemptionModeState,
} from "@/lib/redemption-mode";

type RedemptionModeContextValue = {
  state: RedemptionModeState | null;
  loading: boolean;
  sessionStatus: "inactive" | "ready" | "expired";
  isLocked: boolean;
  refresh: () => Promise<void>;
  clearToLoggedOut: () => Promise<void>;
};

const RedemptionModeContext = createContext<RedemptionModeContextValue | null>(null);

export function RedemptionModeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuthSession();
  const [state, setState] = useState<RedemptionModeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionStatus, setSessionStatus] = useState<"inactive" | "ready" | "expired">("inactive");

  const refresh = useCallback(async () => {
    const nextState = await loadRedemptionModeState();
    setState(nextState);
    if (!nextState) setSessionStatus("inactive");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const result = await ensureRedemptionModeSessionOnBoot();
      if (cancelled) return;
      setState(result.state);
      setSessionStatus(result.status);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    if (!session?.user) {
      setSessionStatus("expired");
      return;
    }
    if (isRedeemerSession(session)) {
      setSessionStatus("ready");
    }
  }, [state, session]);

  const clearToLoggedOut = useCallback(async () => {
    await forceClearRedemptionModeAndSignOut();
    setState(null);
    setSessionStatus("inactive");
  }, []);

  const isLocked = Boolean(state) || isRedeemerSession(session);
  const value = useMemo(
    () => ({ state, loading, sessionStatus, isLocked, refresh, clearToLoggedOut }),
    [state, loading, sessionStatus, isLocked, refresh, clearToLoggedOut],
  );

  return <RedemptionModeContext.Provider value={value}>{children}</RedemptionModeContext.Provider>;
}

export function useRedemptionMode(): RedemptionModeContextValue {
  const ctx = useContext(RedemptionModeContext);
  if (!ctx) {
    throw new Error("useRedemptionMode must be used within RedemptionModeProvider");
  }
  return ctx;
}

export function RedemptionModeGate() {
  const router = useRouter();
  const segments = useSegments();
  const { session } = useAuthSession();
  const { isLocked, loading } = useRedemptionMode();

  useEffect(() => {
    if (loading) return;
    if (!isLocked && !isRedeemerSession(session)) return;
    const root = String(segments[0] ?? "");
    if (root !== "redemption-mode") {
      router.replace("/redemption-mode" as Href);
    }
  }, [isLocked, loading, router, segments, session]);

  return null;
}
