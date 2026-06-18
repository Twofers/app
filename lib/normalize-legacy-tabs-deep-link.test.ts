import { describe, expect, it } from "vitest";

import { normalizeLegacyTabsDeepLink } from "./normalize-legacy-tabs-deep-link";

describe("normalizeLegacyTabsDeepLink", () => {
  it("normalizes legacy tabs host links", () => {
    expect(normalizeLegacyTabsDeepLink("twoforone://tabs/redeem")).toBe("/(tabs)/redeem");
  });

  it("normalizes legacy tabs path links", () => {
    expect(normalizeLegacyTabsDeepLink("twoforone:///tabs/settings")).toBe("/(tabs)/settings");
  });

  it("normalizes encoded route-group tab links", () => {
    expect(normalizeLegacyTabsDeepLink("twoforone:///%2528tabs%2529/redeem")).toBe("/(tabs)/redeem");
    expect(normalizeLegacyTabsDeepLink("twoforone://%2528tabs%2529/redeem")).toBe("/(tabs)/redeem");
  });

  it("normalizes direct route-group tab paths", () => {
    expect(normalizeLegacyTabsDeepLink("/(tabs)/wallet")).toBe("/(tabs)/wallet");
  });

  it("rejects malformed or unknown tab paths", () => {
    expect(normalizeLegacyTabsDeepLink("twoforone:///%E0%A4%A")).toBeNull();
    expect(normalizeLegacyTabsDeepLink("twoforone:///tabs/not-real")).toBeNull();
  });
});
