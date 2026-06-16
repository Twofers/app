/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

/** Canonical spacing — single source: re-exported from `lib/screen-layout`. */
export { Spacing } from '@/lib/screen-layout';
export { Colors, Gray, PrimaryTint } from './theme-colors';

/** Radius scale: chip/badge 8, input + button 12, card 16, pill 999. */
export const Radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

/** Standard control sizing. */
export const Controls = {
  buttonHeight: 52,
};

/**
 * Flat design system: no drop shadows. Cards read as layers via a 1px
 * `border` (gray-200) instead. `soft` is kept as a no-op so legacy spreads
 * stay harmless; do not add new shadows.
 */
export const Shadows = {
  soft: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
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
  },
  titleLg: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700' as const,
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
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodyMuted: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
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
