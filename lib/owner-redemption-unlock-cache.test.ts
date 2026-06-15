import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  removeItem: vi.fn(async (_key: string) => {}),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    removeItem: h.removeItem,
  },
}));

import {
  clearOwnerRedemptionUnlockGraceCache,
  OWNER_REDEMPTION_UNLOCK_GRACE_KEY,
} from "./owner-redemption-unlock-cache";

beforeEach(() => {
  h.removeItem.mockReset();
  h.removeItem.mockResolvedValue(undefined);
});

describe("clearOwnerRedemptionUnlockGraceCache", () => {
  it("removes the owner PIN unlock grace cache key", async () => {
    await clearOwnerRedemptionUnlockGraceCache();

    expect(h.removeItem).toHaveBeenCalledWith(OWNER_REDEMPTION_UNLOCK_GRACE_KEY);
  });

  it("does not throw when local storage cleanup fails", async () => {
    h.removeItem.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(clearOwnerRedemptionUnlockGraceCache()).resolves.toBeUndefined();
  });
});
