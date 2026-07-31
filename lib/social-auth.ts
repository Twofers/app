import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { getGoogleIosClientId, getGoogleWebClientId } from "./runtime-env";
import type { CachedTabModeRole as TabMode } from "./tab-mode-cache";

// The pending-role carry lives in its own module so lib/profiles-role.ts can read it without
// pulling this file's native import graph in. Re-exported so callers keep one entry point.
export {
  PENDING_SOCIAL_ROLE_KEY,
  clearPendingSocialRole,
  peekPendingSocialRole,
  setPendingSocialRole,
  takePendingSocialRole,
} from "./pending-social-role";

/**
 * Native Google / Apple sign-in (Dan approved 2026-07-24). Sessions come from
 * `supabase.auth.signInWithIdToken` against the provider's own native picker — deliberately NOT
 * `signInWithOAuth`/WebBrowser, so no deep link or auth-callback route is involved.
 *
 * The native SDKs load through dynamic `import()` so this module stays importable in the vitest
 * node environment; only the pure decision helpers below are unit-tested.
 */

/** Apple "Hide My Email" hands back a relay address on this domain instead of the real inbox. */
export const APPLE_PRIVATE_RELAY_DOMAIN = "privaterelay.appleid.com";

/** Cancellation codes: Google's classic status code and Apple's rejection code. */
export const GOOGLE_CANCELLED_CODE = "SIGN_IN_CANCELLED";
export const APPLE_CANCELLED_CODE = "ERR_REQUEST_CANCELED";

/** Failures we synthesize ourselves, so the screen can show localized copy instead of raw provider text. */
export type SocialSignInReason = "not_configured" | "no_id_token" | "no_session";

export type SocialAuthLikeError = { message?: string; status?: number; code?: string };

export type SocialSignInResult =
  | { status: "signed_in"; session: Session }
  | { status: "cancelled" }
  | { status: "error"; reason: SocialSignInReason | null; error: SocialAuthLikeError | null };

export type SocialProvider = "google" | "apple";

function errorCode(e: unknown): string {
  const raw = (e as { code?: unknown } | null)?.code;
  return typeof raw === "string" ? raw : "";
}

/**
 * User backed out of the native picker. Google v16 usually reports this as a `cancelled` response
 * rather than a throw, but both SDKs can still reject with a code — treat every shape as a no-op so
 * a dismissed sheet never paints an error banner.
 */
export function isSocialCancellation(e: unknown): boolean {
  const code = errorCode(e);
  return code === GOOGLE_CANCELLED_CODE || code === APPLE_CANCELLED_CODE;
}

/** Normalizes anything thrown by a provider into the shape `friendlyAuthError` reads. */
export function toAuthLikeError(e: unknown): SocialAuthLikeError | null {
  if (!e) return null;
  if (e instanceof Error) {
    const code = errorCode(e);
    return code ? { message: e.message, code } : { message: e.message };
  }
  if (typeof e === "object") return e as SocialAuthLikeError;
  return { message: String(e) };
}

/**
 * True for Apple private-relay addresses. Case-insensitive suffix match: the local part is
 * arbitrary, only the domain identifies a relay.
 */
export function isAppleRelayEmail(email: string | null | undefined): boolean {
  const value = (email ?? "").trim().toLowerCase();
  if (!value) return false;
  return value.endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`);
}

/**
 * Merchant claim matches a confirmed auth email against the approved application email, so a relay
 * address can never claim a business. Block before any business routing happens.
 */
export function shouldBlockBusinessRelayEmail(role: TabMode | null, email: string | null | undefined): boolean {
  return role === "business" && isAppleRelayEmail(email);
}

// --- post-session completion -------------------------------------------------

export type SocialCompletion =
  | { action: "route"; role: TabMode }
  | { action: "adopt"; role: TabMode }
  | { action: "finish_setup" };

/**
 * What to do once a social session exists:
 * - a stored/derived role wins (returning user) → route by it, exactly like password login;
 * - else the role picked on the signup tab → persist it, then route;
 * - else (brand-new user who tapped a social button on the login tab) → ask on-screen.
 */
export function decideSocialCompletion(params: {
  storedRole: TabMode | null;
  pendingRole: TabMode | null;
}): SocialCompletion {
  if (params.storedRole) return { action: "route", role: params.storedRole };
  if (params.pendingRole) return { action: "adopt", role: params.pendingRole };
  return { action: "finish_setup" };
}

// --- providers ---------------------------------------------------------------

let googleConfigured = false;

async function exchangeIdToken(
  provider: SocialProvider,
  token: string,
  nonce?: string,
): Promise<SocialSignInResult> {
  const { data, error } = await supabase.auth.signInWithIdToken(
    nonce ? { provider, token, nonce } : { provider, token },
  );
  if (error) return { status: "error", reason: null, error: toAuthLikeError(error) };
  if (!data?.session) return { status: "error", reason: "no_session", error: null };
  return { status: "signed_in", session: data.session };
}

export async function signInWithGoogle(): Promise<SocialSignInResult> {
  const webClientId = getGoogleWebClientId();
  if (!webClientId) return { status: "error", reason: "not_configured", error: null };
  try {
    const { GoogleSignin } = await import("@react-native-google-signin/google-signin");
    if (!googleConfigured) {
      const iosClientId = getGoogleIosClientId();
      GoogleSignin.configure(iosClientId ? { webClientId, iosClientId } : { webClientId });
      googleConfigured = true;
    }
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (response.type === "cancelled") return { status: "cancelled" };
    const idToken = response.data.idToken;
    if (!idToken) return { status: "error", reason: "no_id_token", error: null };
    return await exchangeIdToken("google", idToken);
  } catch (e: unknown) {
    if (isSocialCancellation(e)) return { status: "cancelled" };
    return { status: "error", reason: null, error: toAuthLikeError(e) };
  }
}

export async function signInWithApple(): Promise<SocialSignInResult> {
  try {
    const AppleAuthentication = await import("expo-apple-authentication");
    const Crypto = await import("expo-crypto");
    // Apple signs the SHA-256 of the nonce into the identity token; Supabase re-hashes the RAW
    // value we hand it and compares. Sending the hashed nonce to either side is the classic
    // "Passed nonce and nonce in id_token should either both exist or not" failure.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    const identityToken = credential.identityToken;
    if (!identityToken) return { status: "error", reason: "no_id_token", error: null };
    return await exchangeIdToken("apple", identityToken, rawNonce);
  } catch (e: unknown) {
    if (isSocialCancellation(e)) return { status: "cancelled" };
    return { status: "error", reason: null, error: toAuthLikeError(e) };
  }
}

/** iOS-only, and only where the OS actually offers it (iOS 13+). */
export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    const AppleAuthentication = await import("expo-apple-authentication");
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Local scope only: a global sign-out misbehaves on the S10 (repo precedent), and this runs while
 * the user is still standing on auth-landing after a blocked business sign-in.
 */
export async function signOutSocialSessionLocally(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* the screen already shows the guidance; a failed sign-out must not replace it with a crash */
  }
  try {
    const { GoogleSignin } = await import("@react-native-google-signin/google-signin");
    await GoogleSignin.signOut();
  } catch {
    /* Google may not have been the provider, or was never configured */
  }
}
