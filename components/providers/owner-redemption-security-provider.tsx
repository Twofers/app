import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuthSession } from "@/components/providers/auth-session-provider";
import {
  createOwnerRedemptionUnlockGraceEntry,
  isOwnerRedemptionUnlockGraceValid,
  parseOwnerRedemptionUnlockGraceCache,
  pruneOwnerRedemptionUnlockGraceCache,
} from "@/lib/owner-redemption-unlock-grace";
import {
  clearOwnerRedemptionUnlockGraceCache,
  OWNER_REDEMPTION_UNLOCK_GRACE_KEY,
} from "@/lib/owner-redemption-unlock-cache";

type OwnerRedemptionSecurityContextValue = {
  isUnlocked: (businessId: string | null | undefined) => boolean;
  markUnlocked: (businessId: string) => void;
  clearUnlock: (businessId?: string | null) => void;
  isPinEnabled: (businessId: string | null | undefined) => boolean | null;
  setPinEnabled: (businessId: string, enabled: boolean) => void;
};

const OwnerRedemptionSecurityContext = createContext<OwnerRedemptionSecurityContextValue | null>(null);

export function OwnerRedemptionSecurityProvider({ children }: { children: ReactNode }) {
  const { session, isInitialLoading } = useAuthSession();
  const userId = session?.user?.id ?? null;
  const [unlockedBusinessIds, setUnlockedBusinessIds] = useState<Set<string>>(() => new Set());
  const [pinEnabledByBusinessId, setPinEnabledByBusinessId] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isInitialLoading) return;
    if (!userId) {
      setUnlockedBusinessIds(new Set());
      void clearOwnerRedemptionUnlockGraceCache();
      return;
    }

    setUnlockedBusinessIds(new Set());
    let cancelled = false;
    void (async () => {
      const raw = await AsyncStorage.getItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY);
      if (cancelled) return;
      const nowMs = Date.now();
      const freshCache = pruneOwnerRedemptionUnlockGraceCache(parseOwnerRedemptionUnlockGraceCache(raw), nowMs);
      const restoredBusinessIds = Object.keys(freshCache).filter((businessId) =>
        isOwnerRedemptionUnlockGraceValid(freshCache, businessId, userId, nowMs),
      );
      if (restoredBusinessIds.length > 0) {
        setUnlockedBusinessIds((current) => {
          const next = new Set(current);
          for (const businessId of restoredBusinessIds) next.add(businessId);
          return next;
        });
      }
      const nextRaw = JSON.stringify(freshCache);
      if (Object.keys(freshCache).length === 0) {
        await AsyncStorage.removeItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY);
      } else if (nextRaw !== raw) {
        await AsyncStorage.setItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY, nextRaw);
      }
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isInitialLoading, userId]);

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
    if (!userId) return;
    void (async () => {
      const raw = await AsyncStorage.getItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY);
      const cache = pruneOwnerRedemptionUnlockGraceCache(parseOwnerRedemptionUnlockGraceCache(raw));
      cache[businessId] = createOwnerRedemptionUnlockGraceEntry(userId);
      await AsyncStorage.setItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY, JSON.stringify(cache));
    })().catch(() => {});
  }, [userId]);

  const clearUnlock = useCallback((businessId?: string | null) => {
    setUnlockedBusinessIds((current) => {
      if (!businessId) return new Set();
      const next = new Set(current);
      next.delete(businessId);
      return next;
    });
    void (async () => {
      if (!businessId) {
        await AsyncStorage.removeItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY);
        return;
      }
      const raw = await AsyncStorage.getItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY);
      const cache = parseOwnerRedemptionUnlockGraceCache(raw);
      delete cache[businessId];
      if (Object.keys(cache).length === 0) {
        await AsyncStorage.removeItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY);
      } else {
        await AsyncStorage.setItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY, JSON.stringify(cache));
      }
    })().catch(() => {});
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
