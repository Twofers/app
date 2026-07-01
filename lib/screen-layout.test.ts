import { describe, expect, it, vi } from "vitest";

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

import {
  ANDROID_BOTTOM_VISIBILITY_FLOOR,
  getBottomSheetBottomPadding,
  getScreenLayoutMetrics,
  getStackFooterMetrics,
  getTabBarMetrics,
  Spacing,
  TAB_BAR_BASE_HEIGHT,
} from "./screen-layout";

describe("getScreenLayoutMetrics", () => {
  it("keeps tab screens above the bottom tab bar with stable scroll/list padding", () => {
    const metrics = getScreenLayoutMetrics({ top: 24, bottom: 0 }, "tab");
    const tabBar = getTabBarMetrics({ top: 24, bottom: 0 });

    expect(metrics.top).toBe(24 + Spacing.md);
    expect(metrics.horizontal).toBe(Spacing.lg);
    expect(metrics.scrollBottom).toBe(tabBar.screenScrollBottom);
    expect(metrics.listBottom).toBe(tabBar.screenListBottom);
  });

  it("adds real safe-area bottom insets to tab chrome and tab screen padding", () => {
    const zeroInset = getTabBarMetrics({ top: 0, bottom: 0 }, "android");
    const homeIndicatorInset = getTabBarMetrics({ top: 0, bottom: 34 }, "android");

    expect(zeroInset.height).toBe(TAB_BAR_BASE_HEIGHT + Spacing.sm);
    expect(zeroInset.bottomOffset).toBe(0);
    expect(homeIndicatorInset.height).toBe(TAB_BAR_BASE_HEIGHT + 34);
    expect(homeIndicatorInset.bottomOffset).toBe(0);
    expect(getScreenLayoutMetrics({ top: 0, bottom: 34 }, "tab", "android").scrollBottom).toBe(
      homeIndicatorInset.screenScrollBottom,
    );
  });

  it("floors stack screen bottom spacing when Android reports a zero bottom inset", () => {
    const metrics = getScreenLayoutMetrics({ top: 0, bottom: 0 }, "stack", "android");

    expect(metrics.scrollBottom).toBe(ANDROID_BOTTOM_VISIBILITY_FLOOR + Spacing.xxxl + Spacing.md);
    expect(metrics.listBottom).toBe(ANDROID_BOTTOM_VISIBILITY_FLOOR + Spacing.xxxl + Spacing.lg);
  });

  it("adds real stack bottom insets when they are larger than the floor", () => {
    const metrics = getScreenLayoutMetrics({ top: 0, bottom: ANDROID_BOTTOM_VISIBILITY_FLOOR + 10 }, "stack", "android");

    expect(metrics.scrollBottom).toBe(ANDROID_BOTTOM_VISIBILITY_FLOOR + 10 + Spacing.xxxl + Spacing.md);
    expect(metrics.listBottom).toBe(ANDROID_BOTTOM_VISIBILITY_FLOOR + 10 + Spacing.xxxl + Spacing.lg);
  });

  it("keeps stack sticky footers above Android navigation overlays", () => {
    const metrics = getStackFooterMetrics({ top: 0, bottom: 0 }, "android");

    expect(metrics.bottom).toBe(ANDROID_BOTTOM_VISIBILITY_FLOOR);
    expect(metrics.scrollPadding).toBe(ANDROID_BOTTOM_VISIBILITY_FLOOR + metrics.minHeight + Spacing.xl);
  });

  it("floors bottom-sheet padding for Android gesture navigation", () => {
    expect(getBottomSheetBottomPadding({ top: 0, bottom: 0 })).toBe(Spacing.lg);
    expect(getBottomSheetBottomPadding({ top: 0, bottom: 34 })).toBe(34);
  });
});
