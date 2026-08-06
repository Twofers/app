import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => h.store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      h.store.set(key, value);
    },
  },
}));

import {
  LEGACY_KEY_NATIVE_WALLET_PASS_ADDED,
  getNativeWalletPassAdded,
  setNativeWalletPassAdded,
} from "./native-wallet-pass-storage";

beforeEach(() => {
  h.store.clear();
});

describe("native wallet pass 'added' flag — namespaced per user (S10 QA finding #4)", () => {
  it("starts false for a user who has never tapped Add to Wallet", async () => {
    expect(await getNativeWalletPassAdded("user-a")).toBe(false);
  });

  it("two user ids on one device get independent flags", async () => {
    await setNativeWalletPassAdded("user-a");

    expect(await getNativeWalletPassAdded("user-a")).toBe(true);
    // A second account signed into the same device/app install must not see
    // user-a's tap — this is the exact device-wide-hide bug being fixed.
    expect(await getNativeWalletPassAdded("user-b")).toBe(false);

    await setNativeWalletPassAdded("user-b");
    expect(await getNativeWalletPassAdded("user-a")).toBe(true);
    expect(await getNativeWalletPassAdded("user-b")).toBe(true);
  });

  it("never reads or writes the legacy global key", async () => {
    h.store.set(LEGACY_KEY_NATIVE_WALLET_PASS_ADDED, "true");

    // A fresh user id must not inherit a "true" left over from the old
    // global key — it is intentionally ignored, not migrated.
    expect(await getNativeWalletPassAdded("user-c")).toBe(false);

    await setNativeWalletPassAdded("user-c");
    expect(h.store.get(LEGACY_KEY_NATIVE_WALLET_PASS_ADDED)).toBe("true"); // untouched
  });
});
