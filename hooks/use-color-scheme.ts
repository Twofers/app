import type { ColorSchemeName } from 'react-native';

/**
 * Light-only lock.
 *
 * app.json sets userInterfaceStyle:"light", so the app never renders dark. Returning
 * a constant here makes every `Colors[colorScheme]` / `=== "dark"` branch across the
 * app resolve to light, removing dead dark-mode code paths (and the latent break from
 * dashboard.tsx hardcoding Colors.light) without editing ~20 screens.
 *
 * Typed as ColorSchemeName (not the literal "light") so existing `=== "dark"`
 * comparisons still type-check. To re-enable dark mode later, restore
 * `export { useColorScheme } from 'react-native'` and remove the app.json lock.
 */
export function useColorScheme(): ColorSchemeName {
  return 'light';
}
