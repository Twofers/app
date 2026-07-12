import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  secureStore: new Map<string, string>(),
  keys: [] as string[],
}));

vi.mock("./redemption-secure-store", () => ({
  secureGetItem: async (key: string) => {
    h.keys.push(key);
    return h.secureStore.get(key) ?? null;
  },
  secureSetItem: async (key: string, value: string) => {
    h.keys.push(key);
    h.secureStore.set(key, value);
  },
  secureDeleteItem: async (key: string) => {
    h.keys.push(key);
    h.secureStore.delete(key);
  },
}));

import {
  clearWalletClaimToken,
  getWalletClaimToken,
  saveWalletClaimToken,
} from "./wallet-claim-token-cache";

const SECURE_STORE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

beforeEach(() => {
  h.secureStore.clear();
  h.keys.length = 0;
});

describe("wallet claim token cache", () => {
  it("uses Expo SecureStore-safe keys for claim token storage", async () => {
    await saveWalletClaimToken("11111111-1111-4111-8111-111111111111", "token-value");

    expect(h.keys).toEqual(["twofer_wallet_claim_token_11111111-1111-4111-8111-111111111111"]);
    expect(h.keys.every((key) => SECURE_STORE_KEY_PATTERN.test(key))).toBe(true);
  });

  it("round-trips and clears a cached token", async () => {
    const claimId = "22222222-2222-4222-8222-222222222222";

    await saveWalletClaimToken(claimId, "token-value");

    expect(await getWalletClaimToken(claimId)).toBe("token-value");

    await clearWalletClaimToken(claimId);

    expect(await getWalletClaimToken(claimId)).toBeNull();
  });
});
