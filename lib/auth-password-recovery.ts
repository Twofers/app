import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { supabase } from "./supabase";

/** Minimum length for new passwords on the reset screen. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Redirect URL for `resetPasswordForEmail`.
 * In Supabase → Authentication → URL Configuration, include both:
 * - twoforone://reset-password
 * - twofer://reset-password
 */
export function getPasswordRecoveryRedirectUrl(): string {
  const rawScheme = Constants.expoConfig?.scheme;
  const primaryScheme = Array.isArray(rawScheme) ? rawScheme[0] : rawScheme;
  return Linking.createURL("reset-password", { scheme: primaryScheme || "twoforone" });
}

/**
 * Parses Supabase recovery tokens from the deep link (hash or query) and establishes a session.
 * Returns true if a session was set from the URL.
 */
export async function consumeSupabaseAuthDeepLink(url: string): Promise<boolean> {
  if (!url || typeof url !== "string") return false;

  let params: URLSearchParams;
  const hashIdx = url.indexOf("#");
  if (hashIdx >= 0) {
    params = new URLSearchParams(url.slice(hashIdx + 1));
  } else {
    const qIdx = url.indexOf("?");
    if (qIdx < 0) return false;
    params = new URLSearchParams(url.slice(qIdx + 1));
  }

  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return false;

  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  return !error;
}

export function validateNewPasswordPair(
  password: string,
  confirm: string,
  minLen: number,
): { ok: true } | { ok: false; key: "required" | "mismatch" | "minLength" } {
  if (!password || !confirm) return { ok: false, key: "required" };
  if (password.length < minLen) return { ok: false, key: "minLength" };
  if (password !== confirm) return { ok: false, key: "mismatch" };
  return { ok: true };
}
