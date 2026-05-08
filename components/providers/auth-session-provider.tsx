import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type AuthSessionContextValue = {
  session: Session | null;
  isInitialLoading: boolean;
};

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // FIX: Track whether `onAuthStateChange` has already delivered a session
    // so we don't overwrite it with a stale `getSession` result. This prevents
    // a race where a token-refresh event arrives before the initial getSession
    // promise resolves, causing the fresh session to be replaced by the old one.
    let authChangeReceived = false;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Stale/invalid refresh token — clear it so the user lands on login
          void supabase.auth.signOut().finally(() => {
            if (!cancelled) {
              setSession(null);
              setIsInitialLoading(false);
            }
          });
          return;
        }
        // Only apply if onAuthStateChange hasn't already delivered a fresher session.
        if (!authChangeReceived) {
          setSession(data.session ?? null);
        }
        setIsInitialLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        void supabase.auth.signOut().catch(() => {});
        setSession(null);
        setIsInitialLoading(false);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authChangeReceived = true;
      setSession(nextSession);
      setIsInitialLoading(false);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthSessionContext.Provider value={{ session, isInitialLoading }}>{children}</AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const v = useContext(AuthSessionContext);
  if (v === undefined) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return v;
}
