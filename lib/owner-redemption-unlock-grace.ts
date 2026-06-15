export const OWNER_REDEMPTION_UNLOCK_GRACE_MS = 5 * 60 * 1000;

export type OwnerRedemptionUnlockGraceEntry = {
  userId: string;
  expiresAt: number;
};

export type OwnerRedemptionUnlockGraceCache = Record<string, OwnerRedemptionUnlockGraceEntry>;

export function createOwnerRedemptionUnlockGraceEntry(
  userId: string,
  nowMs = Date.now(),
): OwnerRedemptionUnlockGraceEntry {
  return {
    userId,
    expiresAt: nowMs + OWNER_REDEMPTION_UNLOCK_GRACE_MS,
  };
}

export function isOwnerRedemptionUnlockGraceValid(
  cache: OwnerRedemptionUnlockGraceCache,
  businessId: string,
  userId: string,
  nowMs = Date.now(),
): boolean {
  const entry = cache[businessId];
  return Boolean(entry && entry.userId === userId && entry.expiresAt > nowMs);
}

export function pruneOwnerRedemptionUnlockGraceCache(
  cache: OwnerRedemptionUnlockGraceCache,
  nowMs = Date.now(),
): OwnerRedemptionUnlockGraceCache {
  const next: OwnerRedemptionUnlockGraceCache = {};
  for (const [businessId, entry] of Object.entries(cache)) {
    if (typeof entry.userId === "string" && entry.userId && entry.expiresAt > nowMs) {
      next[businessId] = entry;
    }
  }
  return next;
}

export function parseOwnerRedemptionUnlockGraceCache(raw: string | null): OwnerRedemptionUnlockGraceCache {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const cache: OwnerRedemptionUnlockGraceCache = {};
    for (const [businessId, entry] of Object.entries(parsed)) {
      if (!businessId || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const maybe = entry as Partial<OwnerRedemptionUnlockGraceEntry>;
      if (typeof maybe.userId === "string" && typeof maybe.expiresAt === "number") {
        cache[businessId] = { userId: maybe.userId, expiresAt: maybe.expiresAt };
      }
    }
    return cache;
  } catch {
    return {};
  }
}
