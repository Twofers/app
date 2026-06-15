import { clearCachedRole } from "./tab-mode";
import { clearOwnerRedemptionUnlockGraceCache } from "./owner-redemption-unlock-cache";

export async function clearLocalAuthSessionState(): Promise<void> {
  await Promise.allSettled([clearCachedRole(), clearOwnerRedemptionUnlockGraceCache()]);
}
