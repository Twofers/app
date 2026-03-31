import { describe, expect, it } from "vitest";

import {
  deriveTabFromSegments,
  shouldCheckBusinessProfileForTab,
  resolveTabModeRedirectTarget,
} from "./tab-mode-redirect";

describe("deriveTabFromSegments", () => {
  it("returns index when tabs segment is absent", () => {
    expect(deriveTabFromSegments(["auth-landing"])).toBe("index");
  });

  it("returns index when tabs root has no child", () => {
    expect(deriveTabFromSegments(["(tabs)"])).toBe("index");
  });

  it("returns child tab segment", () => {
    expect(deriveTabFromSegments(["(tabs)", "map"])).toBe("map");
  });
});

describe("shouldCheckBusinessProfileForTab", () => {
  it("requires profile check for business-only tabs", () => {
    expect(shouldCheckBusinessProfileForTab("create")).toBe(true);
    expect(shouldCheckBusinessProfileForTab("redeem")).toBe(true);
    expect(shouldCheckBusinessProfileForTab("dashboard")).toBe(true);
    expect(shouldCheckBusinessProfileForTab("billing")).toBe(true);
    expect(shouldCheckBusinessProfileForTab("account")).toBe(true);
  });

  it("does not require profile check for consumer tabs", () => {
    expect(shouldCheckBusinessProfileForTab("index")).toBe(false);
    expect(shouldCheckBusinessProfileForTab("map")).toBe(false);
    expect(shouldCheckBusinessProfileForTab("wallet")).toBe(false);
    expect(shouldCheckBusinessProfileForTab("settings")).toBe(false);
  });
});

describe("resolveTabModeRedirectTarget", () => {
  it("redirects business mode away from consumer tabs", () => {
    expect(
      resolveTabModeRedirectTarget({
        mode: "business",
        tab: "map",
        currentPath: "/(tabs)/map",
        forceBypass: false,
        checkingProfile: false,
        businessProfileComplete: true,
      }),
    ).toBe("/(tabs)/create");
  });

  it("redirects incomplete business profile to setup", () => {
    expect(
      resolveTabModeRedirectTarget({
        mode: "business",
        tab: "create",
        currentPath: "/(tabs)/create",
        forceBypass: false,
        checkingProfile: false,
        businessProfileComplete: false,
      }),
    ).toBe("/business-setup");
  });

  it("does not redirect while business profile check is pending", () => {
    expect(
      resolveTabModeRedirectTarget({
        mode: "business",
        tab: "create",
        currentPath: "/(tabs)/create",
        forceBypass: false,
        checkingProfile: true,
        businessProfileComplete: null,
      }),
    ).toBeNull();
  });

  it("redirects customer mode away from business-only tabs", () => {
    expect(
      resolveTabModeRedirectTarget({
        mode: "customer",
        tab: "create",
        currentPath: "/(tabs)/create",
        forceBypass: false,
        checkingProfile: false,
        businessProfileComplete: null,
      }),
    ).toBe("/(tabs)");
  });

  it("redirects customer mode account to settings", () => {
    expect(
      resolveTabModeRedirectTarget({
        mode: "customer",
        tab: "account",
        currentPath: "/(tabs)/account",
        forceBypass: false,
        checkingProfile: false,
        businessProfileComplete: null,
      }),
    ).toBe("/(tabs)/settings");
  });
});
