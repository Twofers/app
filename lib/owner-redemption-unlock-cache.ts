import AsyncStorage from "@react-native-async-storage/async-storage";

export const OWNER_REDEMPTION_UNLOCK_GRACE_KEY = "twofer.ownerRedemptionUnlockGrace.v1";

export async function clearOwnerRedemptionUnlockGraceCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OWNER_REDEMPTION_UNLOCK_GRACE_KEY);
  } catch {
    /* best-effort local cleanup */
  }
}
