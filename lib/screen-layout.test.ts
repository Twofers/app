import { describe, expect, it, vi } from "vitest";

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import { getBottomSheetBottomPadding, getScreenLayoutMetrics, Spacing } from "./screen-layout";

describe("getScreenLayoutMetrics", () => {
  it("keeps tab screens above the bottom tab bar with stable scroll/list padding", () => {
    const metrics = getScreenLayoutMetrics({ top: 24, bottom: 0 }, "tab");

    expect(metrics.top).toBe(24 + Spacing.md);
    expect(metrics.horizontal).toBe(Spacing.lg);
    expect(metrics.scrollBottom).toBe(Spacing.xxxl * 2 + Spacing.md + Spacing.md);
    expect(metrics.listBottom).toBe(Spacing.xxxl * 2 + Spacing.md + Spacing.lg);
  });

  it("does not double-count the safe-area bottom inset for tab screens", () => {
    expect(getScreenLayoutMetrics({ top: 0, bottom: 0 }, "tab").scrollBottom).toBe(
      getScreenLayoutMetrics({ top: 0, bottom: 34 }, "tab").scrollBottom,
    );
  });

  it("floors stack screen bottom spacing when Android reports a zero bottom inset", () => {
    const metrics = getScreenLayoutMetrics({ top: 0, bottom: 0 }, "stack");

    expect(metrics.scrollBottom).toBe(Spacing.lg + Spacing.xl + Spacing.md);
    expect(metrics.listBottom).toBe(Spacing.lg + Spacing.xl + Spacing.lg);
  });

  it("adds real stack bottom insets when they are larger than the floor", () => {
    const metrics = getScreenLayoutMetrics({ top: 0, bottom: 34 }, "stack");

    expect(metrics.scrollBottom).toBe(34 + Spacing.xl + Spacing.md);
    expect(metrics.listBottom).toBe(34 + Spacing.xl + Spacing.lg);
  });

  it("floors bottom-sheet padding for Android gesture navigation", () => {
    expect(getBottomSheetBottomPadding({ top: 0, bottom: 0 })).toBe(Spacing.lg);
    expect(getBottomSheetBottomPadding({ top: 0, bottom: 34 })).toBe(34);
  });
});
