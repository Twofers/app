import { describe, expect, it } from "vitest";

import { consumerSafeHrefFromNext } from "./post-auth-route";

describe("consumerSafeHrefFromNext", () => {
  it("keeps safe consumer tab routes", () => {
    expect(consumerSafeHrefFromNext("/(tabs)/map")).toBe("/(tabs)/map");
    expect(consumerSafeHrefFromNext("/(tabs)/wallet?foo=1")).toBe("/(tabs)/wallet?foo=1");
  });

  it("blocks business-only tabs", () => {
    expect(consumerSafeHrefFromNext("/(tabs)/create")).toBe("/(tabs)");
    expect(consumerSafeHrefFromNext("/(tabs)/dashboard")).toBe("/(tabs)");
    expect(consumerSafeHrefFromNext("/(tabs)/billing")).toBe("/(tabs)");
  });

  it("allows consumer deep links after login", () => {
    expect(consumerSafeHrefFromNext("/deal/deal-123")).toBe("/deal/deal-123");
    expect(consumerSafeHrefFromNext("/business/biz-123")).toBe("/business/biz-123");
  });

  it("falls back to feed for unknown external paths", () => {
    expect(consumerSafeHrefFromNext("/admin/secrets")).toBe("/(tabs)");
  });
});
