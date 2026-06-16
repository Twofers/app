/**
 * Pure color tokens. Keep this file free of React Native imports so tests and
 * non-runtime tooling can validate the palette without loading native modules.
 */

/**
 * Single neutral ramp. Every gray in the app must come from here (no one-off
 * #333 / #888 / slate / zinc / stone hexes in screens).
 */
export const Gray: Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string> = {
  50: '#F9FAFB',
  100: '#F3F4F6',
  200: '#E5E7EB',
  300: '#D1D5DB',
  400: '#9CA3AF',
  500: '#6B7280',
  600: '#4B5563',
  700: '#374151',
  800: '#1F2937',
  900: '#111827',
};

/** Orange tints for selected/highlight surfaces - always pair with `accentText`. */
export const PrimaryTint = {
  surface: 'rgba(255,159,28,0.12)',
  surfaceStrong: 'rgba(255,159,28,0.16)',
  border: 'rgba(255,159,28,0.4)',
} as const;

export const Colors = {
  light: {
    text: Gray[900],
    textPrimary: Gray[900],
    textSecondary: Gray[700],
    textMuted: Gray[600],
    textInverse: '#FFFFFF',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    /** Section fills + unselected chip/pill background (gray-100). */
    surfaceMuted: Gray[100],
    border: Gray[200],
    divider: Gray[200],
    mutedText: Gray[500],
    tint: '#FF9F1C', // Penguin orange (primary)
    primary: '#FF9F1C', // Use for all big CTAs
    primaryText: '#11181C',
    accent: '#FF9F1C',
    // Brand orange #FF9F1C is ~2:1 on white and fails WCAG AA as small text.
    // Use `accentText` for orange TEXT (time-left, distance, links, pills); keep
    // `primary`/`tint` for fills, buttons, and tab accents. #B45309 = 5.0:1 on
    // white, 4.8:1 on surfaceMuted.
    accentText: '#B45309',
    secondary: Gray[900],
    icon: Gray[500],
    tabIconDefault: Gray[500],
    tabIconSelected: '#FF9F1C',
    /** The one destructive red. */
    danger: '#DC2626',
    dangerText: '#991B1B',
    warning: '#B45309',
    warningText: '#7C2D12',
    /**
     * The one success green. Reserved for redemption confirmation surfaces
     * (redeemed wallet pass, QR / staff redemption success) - everything else
     * uses orange or neutrals.
     */
    success: '#15803D',
    successText: '#166534',
    favorite: '#E0245E',
    disabledBackground: Gray[100],
    disabledText: Gray[600],
    inputBackground: '#FFFFFF',
    inputText: Gray[900],
    inputPlaceholder: Gray[600],
    overlay: 'rgba(0,0,0,0.6)',
    qrContainerBackground: '#FFFFFF',
  },
  dark: {
    text: '#ECEDEE',
    textPrimary: '#ECEDEE',
    textSecondary: '#D5DBE1',
    textMuted: '#B4BCC5',
    textInverse: '#11181C',
    background: '#151718',
    surface: '#1b1e20',
    surfaceElevated: '#24282c',
    surfaceMuted: '#202427',
    border: '#2a2f33',
    divider: '#2a2f33',
    mutedText: '#b4bcc5',
    tint: '#FF9F1C',
    primary: '#FF9F1C',
    primaryText: '#11181C',
    accent: '#FF9F1C',
    // Lighter orange for legible accent text on dark surfaces.
    accentText: '#FFB454',
    secondary: '#ECEDEE',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#FF9F1C',
    // Status / feedback colors - lighter variants for legibility on dark backgrounds.
    danger: '#F87171',
    dangerText: '#FCA5A5',
    warning: '#FCD34D',
    warningText: '#FDE68A',
    success: '#4ADE80',
    successText: '#BBF7D0',
    favorite: '#F0467A',
    disabledBackground: '#202427',
    disabledText: '#9BA1A6',
    inputBackground: '#1b1e20',
    inputText: '#ECEDEE',
    inputPlaceholder: '#B4BCC5',
    overlay: 'rgba(0,0,0,0.72)',
    qrContainerBackground: '#FFFFFF',
  },
};
