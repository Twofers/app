import { Linking } from "react-native";

/**
 * Production legal & support pages. Defaults match `.env.example` / store listings; override with EXPO_PUBLIC_* in `.env` or EAS.
 */
export const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? "https://www.twoferapp.com/privacy";

export const TERMS_OF_SERVICE_URL =
  process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL ?? "https://www.twoferapp.com/terms";

export const SUPPORT_URL = process.env.EXPO_PUBLIC_SUPPORT_URL ?? "https://www.twoferapp.com/support";

export const DELETE_ACCOUNT_URL =
  process.env.EXPO_PUBLIC_DELETE_ACCOUNT_URL ?? "https://www.twoferapp.com/delete-account";

/** @deprecated Use PRIVACY_POLICY_URL */
export const LEGAL_PRIVACY_URL = PRIVACY_POLICY_URL;

/** @deprecated Use TERMS_OF_SERVICE_URL */
export const LEGAL_TERMS_URL = TERMS_OF_SERVICE_URL;

export async function openWebsiteUrl(url: string): Promise<boolean> {
  const supported = await Linking.canOpenURL(url);
  if (!supported) return false;
  await Linking.openURL(url);
  return true;
}
