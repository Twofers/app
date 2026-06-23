import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";

import {
  normalizeSupportedLocale,
  type SupportedLocale,
} from "./supported-locales";

const KEY_CUSTOMER_PREFERRED_DEAL_LOCALE = "twoforone.consumer.preferred_locale";

export async function getCustomerPreferredDealLocale(): Promise<SupportedLocale | null> {
  const stored = await AsyncStorage.getItem(KEY_CUSTOMER_PREFERRED_DEAL_LOCALE);
  return normalizeSupportedLocale(stored);
}

export async function setCustomerPreferredDealLocale(locale: SupportedLocale): Promise<void> {
  await AsyncStorage.setItem(KEY_CUSTOMER_PREFERRED_DEAL_LOCALE, locale);
}

export function getDeviceDealLocale(): SupportedLocale | null {
  return normalizeSupportedLocale(Localization.getLocales()[0]?.languageTag);
}
