import { Platform } from "react-native";
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
type ScreenInsets = {
  top: number;
  bottom: number;
};

export const TAB_BAR_BASE_HEIGHT = 64;
export const TAB_BAR_ANDROID_BOTTOM_FLOOR = Spacing.sm;
export const ANDROID_BOTTOM_VISIBILITY_FLOOR = Spacing.xxl;
const TAB_BAR_IOS_BOTTOM_FLOOR = 6;
export const STACK_ANDROID_BOTTOM_FLOOR = ANDROID_BOTTOM_VISIBILITY_FLOOR;
const STACK_DEFAULT_BOTTOM_FLOOR = Spacing.lg;

export type TabBarPlatform = "android" | "ios" | "default";

export function getTabBarMetrics(insets: ScreenInsets, platform: TabBarPlatform = "default") {
  const bottomOffset = 0;
  const bottomFloor =
    platform === "android" ? TAB_BAR_ANDROID_BOTTOM_FLOOR : platform === "ios" ? TAB_BAR_IOS_BOTTOM_FLOOR : Spacing.sm;
  const bottomPadding = Math.max(insets.bottom, bottomFloor);
  const height = TAB_BAR_BASE_HEIGHT + bottomPadding + bottomOffset;
  return {
    bottomOffset,
    bottomPadding,
    height,
    screenScrollBottom: height + Spacing.lg,
    screenListBottom: height + Spacing.xl,
  };
}

export function getScreenLayoutMetrics(
  insets: ScreenInsets,
  variant: ScreenVariant = "tab",
  platform: TabBarPlatform = "default",
) {
  // Floor the stack-screen bottom inset: on Android edge-to-edge dev clients
  // insets.bottom can report 0, which let bottom CTAs sit against the home
  // indicator / nav bar. Keep the floor modest; a large value pushes CTAs into
  // the middle of compact screens.
  const tabBarMetrics = variant === "tab" ? getTabBarMetrics(insets, platform) : null;
  const stackBottomFloor = platform === "android" ? STACK_ANDROID_BOTTOM_FLOOR : STACK_DEFAULT_BOTTOM_FLOOR;
  const bottomInset = tabBarMetrics?.screenScrollBottom ?? Math.max(insets.bottom, stackBottomFloor) + Spacing.xxxl;
  const listBottom = tabBarMetrics?.screenListBottom ?? bottomInset + Spacing.lg;

  return {
    insets,
    /** Outer screen top padding below status bar / notch. */
    top: insets.top + Spacing.md,
    horizontal: Spacing.lg,
    /** ScrollView / non-list content. */
    scrollBottom: variant === "tab" ? bottomInset : bottomInset + Spacing.md,
    /** FlatList contentContainerStyle.paddingBottom. */
    listBottom,
  };
}

export function getStackFooterMetrics(insets: ScreenInsets, platform: TabBarPlatform = "default") {
  const bottom = Math.max(
    insets.bottom,
    platform === "android" ? STACK_ANDROID_BOTTOM_FLOOR : STACK_DEFAULT_BOTTOM_FLOOR,
  );
  const minHeight = 76;

  return {
    bottom,
    minHeight,
    scrollPadding: bottom + minHeight + Spacing.xl,
  };
}

export function getBottomSheetBottomPadding(insets: ScreenInsets) {
  return Math.max(insets.bottom, Spacing.lg);
}

export function useScreenInsets(variant: ScreenVariant = "tab") {
  const platform: TabBarPlatform =
    Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "default";
  return getScreenLayoutMetrics(useSafeAreaInsets(), variant, platform);
}
