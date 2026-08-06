import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Remembers that this device already added the Twofer Card to its native
 * wallet, so the Add-to-Wallet badge collapses instead of nagging. Local-only
 * convenience state — re-adding from another device is always safe (the pass
 * object is one-per-user server-side).
 *
 * Namespaced by user id (S10 QA 2026-08-02 finding #4): the original key had
 * no user id, so one account tapping "Add to Wallet" hid the badge device-wide
 * for every account. The legacy global key below is deliberately left in
 * place and never read by this module again — worst case a user who tapped
 * it under the old scheme sees the badge once more, which Wallet's own
 * save-dedupe makes harmless.
 */
/** Never read/written by this module anymore — kept only so tests can assert it stays untouched. */
export const LEGACY_KEY_NATIVE_WALLET_PASS_ADDED = "twoforone.consumer.native_wallet_pass_added";
const KEY_NATIVE_WALLET_PASS_ADDED_PREFIX = "twoforone.consumer.native_wallet_pass_added.";

function keyFor(userId: string): string {
  return `${KEY_NATIVE_WALLET_PASS_ADDED_PREFIX}${userId}`;
}

export async function getNativeWalletPassAdded(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(keyFor(userId))) === "true";
  } catch {
    return false;
  }
}

export async function setNativeWalletPassAdded(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), "true");
  } catch {
    // Best-effort: worst case the badge shows again next session.
  }
}
