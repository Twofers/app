import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type OwnerRedemptionSecurityContextValue = {
  isUnlocked: (businessId: string | null | undefined) => boolean;
  markUnlocked: (businessId: string) => void;
  clearUnlock: (businessId?: string | null) => void;
};

const OwnerRedemptionSecurityContext = createContext<OwnerRedemptionSecurityContextValue | null>(null);

export function OwnerRedemptionSecurityProvider({ children }: { children: ReactNode }) {
  const [unlockedBusinessIds, setUnlockedBusinessIds] = useState<Set<string>>(() => new Set());

  const isUnlocked = useCallback(
    (businessId: string | null | undefined) => Boolean(businessId && unlockedBusinessIds.has(businessId)),
    [unlockedBusinessIds],
  );

  const markUnlocked = useCallback((businessId: string) => {
    setUnlockedBusinessIds((current) => {
      const next = new Set(current);
      next.add(businessId);
      return next;
    });
  }, []);

  const clearUnlock = useCallback((businessId?: string | null) => {
    setUnlockedBusinessIds((current) => {
      if (!businessId) return new Set();
      const next = new Set(current);
      next.delete(businessId);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ isUnlocked, markUnlocked, clearUnlock }),
    [clearUnlock, isUnlocked, markUnlocked],
  );

  return (
    <OwnerRedemptionSecurityContext.Provider value={value}>
      {children}
    </OwnerRedemptionSecurityContext.Provider>
  );
}

export function useOwnerRedemptionSecurity(): OwnerRedemptionSecurityContextValue {
  const ctx = useContext(OwnerRedemptionSecurityContext);
  if (!ctx) {
    throw new Error("useOwnerRedemptionSecurity must be used within OwnerRedemptionSecurityProvider");
  }
  return ctx;
}
