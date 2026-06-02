import type { ColorSchemeName } from 'react-native';

/**
 * Light-only lock (web). Mirrors hooks/use-color-scheme.ts — always light while
 * app.json pins userInterfaceStyle:"light". Typed as ColorSchemeName so existing
 * `=== "dark"` checks still compile.
 */
export function useColorScheme(): ColorSchemeName {
  return 'light';
}
