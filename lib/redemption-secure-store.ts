import { Platform } from "react-native";

// Secure storage for Redemption Mode secrets (exit token, staff session).
// Native uses expo-secure-store via a lazy import so web bundles never load
// it; web falls back to localStorage with an in-memory map behind it.
//
// Lives in its own module so tests can mock this file directly instead of
// mocking the dynamically imported "expo-secure-store" package — vi.mock on a
// dynamic npm import resolved differently on the Linux CI runner and let the
// real Expo module into the test graph (CI-only failure, 2026-06-11).

const memorySecureStore = new Map<string, string>();

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export async function secureGetItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    if (!hasWindow()) return memorySecureStore.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memorySecureStore.get(key) ?? null;
    }
  }
  const SecureStore = await import("expo-secure-store");
  return SecureStore.getItemAsync(key);
}

export async function secureSetItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (!hasWindow()) {
      memorySecureStore.set(key, value);
      return;
    }
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memorySecureStore.set(key, value);
    }
    return;
  }
  const SecureStore = await import("expo-secure-store");
  await SecureStore.setItemAsync(key, value);
}

export async function secureDeleteItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    memorySecureStore.delete(key);
    if (hasWindow()) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* noop */
      }
    }
    return;
  }
  const SecureStore = await import("expo-secure-store");
  await SecureStore.deleteItemAsync(key);
}
