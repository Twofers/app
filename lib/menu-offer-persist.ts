import AsyncStorage from "@react-native-async-storage/async-storage";

import type { MenuOfferPairingType } from "@/lib/menu-offer";

const KEY = "@twof/lastMenuOfferPairingType";

const VALID: MenuOfferPairingType[] = [
  "free_with_purchase",
  "bogo_pair",
  "second_half_off",
  "percent_off",
  "fixed_price_special",
];

export function isMenuOfferPairingType(s: string): s is MenuOfferPairingType {
  return (VALID as string[]).includes(s);
}

export async function loadLastMenuOfferPairingType(): Promise<MenuOfferPairingType | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw == null || raw === "") return null;
    return isMenuOfferPairingType(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function saveLastMenuOfferPairingType(t: MenuOfferPairingType): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
}
