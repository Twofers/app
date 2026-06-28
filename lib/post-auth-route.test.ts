import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const asyncStore = new Map<string, string>();
  return {
    asyncStore,
    getBusinessProfileAccessForCurrentUser: vi.fn(async () => ({ isComplete: true })),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => h.asyncStore.get(key) ?? null,
    setItem: async (key: string, value: string) => void h.asyncStore.set(key, value),
    removeItem: async (key: string) => void h.asyncStore.delete(key),
  },
}));

vi.mock("./business-profile-access", () => ({
  getBusinessProfileAccessForCurrentUser: h.getBusinessProfileAccessForCurrentUser,
}));

import { consumerSafeHrefFromNext, consumePendingDeepLink, resolvePostAuthReplaceHref } from "./post-auth-route";

beforeEach(() => {
  h.asyncStore.clear();
  h.getBusinessProfileAccessForCurrentUser.mockReset();
  h.getBusinessProfileAccessForCurrentUser.mockResolvedValue({ isComplete: true });
});

describe("consumerSafeHrefFromNext", () => {
  it("keeps safe consumer tab routes", () => {
    expect(consumerSafeHrefFromNext("/(tabs)/map")).toBe("/(tabs)/map");
    expect(consumerSafeHrefFromNext("/(tabs)/wallet?foo=1")).toBe("/(tabs)/wallet?foo=1");
  });

  it("blocks business-only tabs", () => {
    expect(consumerSafeHrefFromNext("/(tabs)/create")).toBe("/(tabs)");
    expect(consumerSafeHrefFromNext("/(tabs)/dashboard")).toBe("/(tabs)");
    expect(consumerSafeHrefFromNext("/(tabs)/billing")).toBe("/(tabs)");
    expect(consumerSafeHrefFromNext("/(tabs)/account/billing")).toBe("/(tabs)");
  });

  it("allows consumer deep links after login", () => {
    expect(consumerSafeHrefFromNext("/deal/deal-123")).toBe("/deal/deal-123");
    expect(consumerSafeHrefFromNext("/business/biz-123")).toBe("/business/biz-123");
  });

  it("falls back to feed for unknown external paths", () => {
    expect(consumerSafeHrefFromNext("/admin/secrets")).toBe("/(tabs)");
  });
});

describe("resolvePostAuthReplaceHref", () => {
  it("routes a complete business account to the business create surface", async () => {
    await expect(
      resolvePostAuthReplaceHref({ role: "business", nextParam: "/(tabs)/wallet" }),
    ).resolves.toBe("/(tabs)/create");
    expect(h.getBusinessProfileAccessForCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("routes incomplete business accounts to setup and preserves the requested destination", async () => {
    h.getBusinessProfileAccessForCurrentUser.mockResolvedValueOnce({ isComplete: false });

    await expect(
      resolvePostAuthReplaceHref({ role: "business", nextParam: "/deal/deal_1" }),
    ).resolves.toBe("/business-setup");
    await expect(consumePendingDeepLink()).resolves.toBe("/deal/deal_1");
  });

  it("routes customer accounts away from business-only destinations without a profile check", async () => {
    await expect(
      resolvePostAuthReplaceHref({ role: "customer", nextParam: "/(tabs)/dashboard" }),
    ).resolves.toBe("/(tabs)");
    expect(h.getBusinessProfileAccessForCurrentUser).not.toHaveBeenCalled();
  });

  it("preserves billing-under-account deep links for complete business accounts", async () => {
    await expect(
      resolvePostAuthReplaceHref({ role: "business", nextParam: "/(tabs)/account/billing?checkout=success" }),
    ).resolves.toBe("/(tabs)/account/billing?checkout=success");
    expect(h.getBusinessProfileAccessForCurrentUser).toHaveBeenCalledTimes(1);
  });
});
