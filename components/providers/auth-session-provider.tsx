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
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session ?? null);
        setIsInitialLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
        setIsInitialLoading(false);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
