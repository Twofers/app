import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import type { AppLocale } from "../i18n/config";
import { isAppLocale } from "../i18n/config";

const KEY_UI_LOCALE = "twoforone.ui_locale";
const KEY_MANUAL_OVERRIDE = "twoforone.locale_manual_override";

/** Map device tag to supported app locale; everything else → English. */
export function deviceToAppLocale(): AppLocale {
  const tag = Localization.getLocales()[0]?.languageTag ?? "en";
  const low = tag.toLowerCase();
  if (low.startsWith("es")) return "es";
  if (low.startsWith("ko")) return "ko";
  if (low.startsWith("en")) return "en";
  return "en";
}

/**
 * Resolve UI locale: manual choice wins; else saved locale from first run; else device (and persist).
 */
export async function hydrateUiLocale(): Promise<AppLocale> {
  const manual = await AsyncStorage.getItem(KEY_MANUAL_OVERRIDE);
  const saved = await AsyncStorage.getItem(KEY_UI_LOCALE);

  if (manual === "1" && isAppLocale(saved)) {
    return saved;
  }

  if (isAppLocale(saved)) {
    return saved;
  }

  const initial = deviceToAppLocale();
  await AsyncStorage.setItem(KEY_UI_LOCALE, initial);
  return initial;
}

export async function setUiLocalePreference(locale: AppLocale, options: { manual: boolean }) {
  await AsyncStorage.setItem(KEY_UI_LOCALE, locale);
  if (options.manual) {
    await AsyncStorage.setItem(KEY_MANUAL_OVERRIDE, "1");
  }
}
