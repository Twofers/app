/**
 * Native wallet pass ("Twofer Card") — Apple issue path (Deno/edge).
 * Reads the Apple signing secrets, mints/reuses the per-user serial + stable
 * web-service auth token, builds the current card content, and returns a signed
 * .pkpass carrying the webServiceURL so the card auto-updates (part 2). Kept
 * separate from wallet-pass-sync.ts so the claim-lifecycle functions don't
 * bundle the pkpass signing code.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildSignedPkpass } from "./apple-pkpass.ts";
import { getAppleWalletEnv, getWalletWebServiceUrl } from "./apple-pass-env.ts";
import { appleAuthTokenHash, deriveAppleAuthToken } from "./apple-pass-auth.ts";
import {
  buildWalletPassContent,
  deriveWalletPassState,
  resolveWalletPassLocale,
} from "./wallet-pass-content.ts";
import {
  isNativeWalletPassServerEnabled,
  loadWalletPassClaimRows,
} from "./wallet-pass-sync.ts";

export type IssueApplePassResult =
  | { ok: true; pkpass: Uint8Array; serialNumber: string }
  | { ok: false; errorCode: "feature_disabled" | "not_configured" | "provider_error" };

/**
 * Builds the current signed .pkpass for a user WITHOUT writing to the DB — used
 * by the web service's "serve latest pass" (which must not bump updated_at).
 * Returns null if Apple isn't configured or signing fails.
 */
export async function buildAppleWalletPassBytes(
  supabaseAdmin: SupabaseClient,
  userId: string,
  serialNumber: string,
  locale: string,
): Promise<Uint8Array | null> {
  const env = getAppleWalletEnv();
  if (!env) return null;
  const serverSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const webServiceURL = getWalletWebServiceUrl();
  const authToken = serverSecret ? await deriveAppleAuthToken(serverSecret, userId) : null;
  const rows = await loadWalletPassClaimRows(supabaseAdmin, userId);
  const content = buildWalletPassContent(
    deriveWalletPassState(rows, Date.now(), resolveWalletPassLocale(locale)),
    resolveWalletPassLocale(locale),
  );
  try {
    return buildSignedPkpass(content, {
      serialNumber,
      passTypeId: env.passTypeId,
      teamId: env.teamId,
      certPem: env.certPem,
      keyPem: env.keyPem,
      wwdrPem: env.wwdrPem,
      // Only attach the web service when both pieces are available, so a
      // misconfigured deploy still issues a valid (static) pass.
      webServiceURL: webServiceURL && authToken ? webServiceURL : null,
      authenticationToken: webServiceURL && authToken ? authToken : null,
    });
  } catch (err) {
    console.error("[wallet-pass] pkpass build failed:", err instanceof Error ? err.message : "unknown");
    return null;
  }
}

export async function issueAppleWalletPass(
  supabaseAdmin: SupabaseClient,
  userId: string,
  requestedLocale: unknown,
): Promise<IssueApplePassResult> {
  if (!isNativeWalletPassServerEnabled()) return { ok: false, errorCode: "feature_disabled" };
  const env = getAppleWalletEnv();
  if (!env) return { ok: false, errorCode: "not_configured" };

  const locale = resolveWalletPassLocale(requestedLocale);

  // Stable per-user serial: reuse if present, else mint and persist.
  const { data: existing } = await supabaseAdmin
    .from("wallet_passes")
    .select("apple_serial_number")
    .eq("user_id", userId)
    .maybeSingle();
  const serialNumber = (existing?.apple_serial_number as string | null) ?? crypto.randomUUID();

  // Stable web-service auth token (HMAC of the service secret + user id).
  const serverSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authToken = serverSecret ? await deriveAppleAuthToken(serverSecret, userId) : null;
  const authTokenHash = authToken ? await appleAuthTokenHash(authToken) : null;

  const { error: upsertError } = await supabaseAdmin.from("wallet_passes").upsert(
    {
      user_id: userId,
      apple_serial_number: serialNumber,
      apple_auth_token_hash: authTokenHash,
      pass_locale: locale,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) {
    console.error("[wallet-pass] apple wallet_passes upsert failed:", upsertError.code ?? upsertError.message);
    return { ok: false, errorCode: "provider_error" };
  }

  const pkpass = await buildAppleWalletPassBytes(supabaseAdmin, userId, serialNumber, locale);
  if (!pkpass) return { ok: false, errorCode: "provider_error" };
  return { ok: true, pkpass, serialNumber };
}
