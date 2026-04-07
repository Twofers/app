/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

/** Canonical spacing — single source: re-exported from `lib/screen-layout`. */
export { Spacing } from '@/lib/screen-layout';

/**
 * Twofer visual tokens — 2026 delivery-app polish.
 */
export const Colors = {
  light: {
    text: '#11181C',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceMuted: '#F8F9FA',
    border: '#E7E9EE',
    mutedText: '#5F6773',
    tint: '#FF9F1C', // Penguin orange (primary)
    primary: '#FF9F1C', // Use for all big CTAs
    primaryText: '#FFFFFF',
    secondary: '#11181C',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: '#FF9F1C',
    cardShadow: '#000000',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    surface: '#1b1e20',
    surfaceMuted: '#202427',
    border: '#2a2f33',
    mutedText: '#b4bcc5',
    tint: '#FF9F1C',
    primary: '#FF9F1C',
    primaryText: '#11181C',
    secondary: '#ECEDEE',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#FF9F1C',
    cardShadow: '#000000',
  },
};

export const Radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  /** Hero / marketing cards (brand: 24px corners). */
  card: 24,
  pill: 999,
};

export const Shadows = {
  soft: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  none: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
};

export const Typography = {
  titleXl: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700' as const,
    color: '#11181C',
  },
  titleLg: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as const,
    color: '#11181C',
  },
  /** Tab / stack screen titles — pair with `theme.text` for color. */
  screenTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
  },
  heading: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700' as const,
    color: '#11181C',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    color: '#11181C',
  },
  bodyMuted: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
    color: '#5F6773',
  },
  caption: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
    color: '#5F6773',
  },
};

/**
 * Native iOS/Android: omit `fontFamily` for body text so RN uses the platform system UI font (matches Expo Go).
 * Web keeps explicit stacks. Use `mono` only where a fixed-width font is intentional.
 */
export const Fonts = Platform.select({
  ios: { sans: "system-ui", serif: "ui-serif", rounded: "ui-rounded", mono: "ui-monospace" },
  default: { sans: "normal", serif: "serif", rounded: "normal", mono: "monospace" },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
});
