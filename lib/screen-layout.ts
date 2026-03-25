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

type ScreenVariant = "tab" | "stack";

/**
 * Tab screens are laid out **above** the bottom tab bar; the bar already clears the home indicator.
 * Adding `safe area bottom + fixed tab height` here double-counted insets and diverged on Android
 * edge-to-edge / Expo Go vs native release. Use modest scroll padding only.
 */
const TAB_SCREEN_SCROLL_EXTRA = Spacing.xxxl + Spacing.md;

export function useScreenInsets(variant: ScreenVariant = "tab") {
  const insets = useSafeAreaInsets();
  const bottomInset =
    variant === "tab" ? TAB_SCREEN_SCROLL_EXTRA : insets.bottom + Spacing.xl;

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
