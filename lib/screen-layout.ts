import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Visual rhythm — use these instead of one-off magic numbers. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/**
 * Tab bar main column (icons + label), excluding the system home-indicator inset.
 * React Navigation / Expo tabs land around 49–56dp; we pad generously for Android labels.
 */
const TAB_BAR_COLUMN = 56;

type ScreenVariant = "tab" | "stack";

export function useScreenInsets(variant: ScreenVariant = "tab") {
  const insets = useSafeAreaInsets();
  const tabOffset = variant === "tab" ? TAB_BAR_COLUMN : 0;
  const bottomInset = insets.bottom + tabOffset + Spacing.xl;

  return {
    insets,
    /** Outer screen top padding below status bar / notch. */
    top: insets.top + Spacing.md,
    horizontal: Spacing.lg,
    /** ScrollView / non-list content. */
    scrollBottom: bottomInset + Spacing.md,
    /** FlatList contentContainerStyle.paddingBottom. */
    listBottom: bottomInset + Spacing.lg,
  };
}
