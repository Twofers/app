import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { supabase } from "./supabase";

/** Minimum length for new passwords on the reset screen. */
export const PASSWORD_MIN_LENGTH = 8;

function primaryAppScheme(): string {
  const rawScheme = Constants.expoConfig?.scheme;
  return Array.isArray(rawScheme) ? rawScheme[0] : rawScheme || "twoforone";
}

/**
 * Redirect URL for `resetPasswordForEmail`.
 * In Supabase → Authentication → URL Configuration, include both:
 * - twoforone://reset-password
 * - twofer://reset-password
 */
export function getPasswordRecoveryRedirectUrl(): string {
  return Linking.createURL("reset-password", { scheme: primaryAppScheme() });
}

/**
 * Redirect for signup confirmation (and email OTP) so the link opens the app, not only the Site URL.
 * Add the exact URL in Supabase → Authentication → URL Configuration → Additional Redirect URLs:
 * - twoforone://auth-callback
 * - twofer://auth-callback
 * - Expo dev URLs (see `npx uri-scheme list` or your Metro URL)
 */
export function getEmailAuthRedirectUrl(): string {
  return Linking.createURL("auth-callback", { scheme: primaryAppScheme() });
}

function mergeAuthUrlParams(url: string): URLSearchParams {
  const merged = new URLSearchParams();
  const qIdx = url.indexOf("?");
  const hashIdx = url.indexOf("#");
  if (qIdx >= 0) {
    const end = hashIdx >= 0 && hashIdx > qIdx ? hashIdx : url.length;
    const qs = url.slice(qIdx + 1, end);
    new URLSearchParams(qs).forEach((v, k) => merged.set(k, v));
  }
  if (hashIdx >= 0) {
    new URLSearchParams(url.slice(hashIdx + 1)).forEach((v, k) => merged.set(k, v));
  }
  return merged;
}

export type AuthDeepLinkResult =
  | { ok: false }
  | { ok: true; flow: "recovery" | "signup" };

/**
 * Parses Supabase auth callback URLs (email confirmation, magic link, password recovery).
 * PKCE (`code=`), implicit tokens in hash, or query + hash combined.
 * `flow` is `recovery` only when `type=recovery` — use this to route to the reset-password screen.
 */
export async function consumeSupabaseAuthDeepLink(url: string): Promise<AuthDeepLinkResult> {
  if (!url || typeof url !== "string") return { ok: false };

  const params = mergeAuthUrlParams(url);
  if (params.get("error") || params.get("error_description")) return { ok: false };

  const type = (params.get("type") ?? "").toLowerCase();
  const flowFromType: "recovery" | "signup" = type === "recovery" ? "recovery" : "signup";

  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return { ok: false };
    return { ok: true, flow: flowFromType };
  }

  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) return { ok: false };
    return { ok: true, flow: flowFromType };
  }

  return { ok: false };
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
