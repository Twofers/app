import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type OwnerRedemptionSecurityContextValue = {
  isUnlocked: (businessId: string | null | undefined) => boolean;
  markUnlocked: (businessId: string) => void;
  clearUnlock: (businessId?: string | null) => void;
  isPinEnabled: (businessId: string | null | undefined) => boolean | null;
  setPinEnabled: (businessId: string, enabled: boolean) => void;
};

const OwnerRedemptionSecurityContext = createContext<OwnerRedemptionSecurityContextValue | null>(null);

export function OwnerRedemptionSecurityProvider({ children }: { children: ReactNode }) {
  const [unlockedBusinessIds, setUnlockedBusinessIds] = useState<Set<string>>(() => new Set());
  const [pinEnabledByBusinessId, setPinEnabledByBusinessId] = useState<Record<string, boolean>>({});

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

  const isPinEnabled = useCallback(
    (businessId: string | null | undefined) => {
      if (!businessId) return null;
      return pinEnabledByBusinessId[businessId] ?? null;
    },
    [pinEnabledByBusinessId],
  );

  const setPinEnabled = useCallback((businessId: string, enabled: boolean) => {
    setPinEnabledByBusinessId((current) => ({ ...current, [businessId]: enabled }));
  }, []);

  const value = useMemo(
    () => ({ isUnlocked, markUnlocked, clearUnlock, isPinEnabled, setPinEnabled }),
    [clearUnlock, isPinEnabled, isUnlocked, markUnlocked, setPinEnabled],
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
