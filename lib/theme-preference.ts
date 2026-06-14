import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemePreference = "system" | "light" | "dark";

const KEY_THEME_PREFERENCE = "twoforone.theme_preference";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export async function hydrateThemePreference(): Promise<ThemePreference> {
  const saved = await AsyncStorage.getItem(KEY_THEME_PREFERENCE);
  return isThemePreference(saved) ? saved : "system";
}

export async function setStoredThemePreference(preference: ThemePreference) {
  await AsyncStorage.setItem(KEY_THEME_PREFERENCE, preference);
}
