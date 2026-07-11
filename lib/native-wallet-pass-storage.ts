import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Remembers that this device already added the Twofer Card to its native
 * wallet, so the Add-to-Wallet badge collapses instead of nagging. Local-only
 * convenience state — re-adding from another device is always safe (the pass
 * object is one-per-user server-side).
 */
const KEY_NATIVE_WALLET_PASS_ADDED = "twoforone.consumer.native_wallet_pass_added";

export async function getNativeWalletPassAdded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_NATIVE_WALLET_PASS_ADDED)) === "true";
  } catch {
    return false;
  }
}

export async function setNativeWalletPassAdded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_NATIVE_WALLET_PASS_ADDED, "true");
  } catch {
    // Best-effort: worst case the badge shows again next session.
  }
}
