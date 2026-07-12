/**
 * Native wallet pass ("Twofer Card") — Deno/Supabase side: reads claim state,
 * signs Google Wallet JWTs, and keeps the user's pass object in sync.
 * Pure content logic lives in wallet-pass-content.ts (vitest-covered).
 *
 * Everything here is best-effort: `syncWalletPassForUser` NEVER throws into its
 * caller, and no log line may contain tokens, short codes, save URLs, or
 * provider response bodies.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildGoogleSaveJwtClaims,
  buildGoogleWalletGenericObject,
  buildGoogleWalletObjectId,
  buildWalletPassContent,
  deriveWalletPassState,
  resolveWalletPassLocale,
  type WalletPassClaimRow,
  type WalletPassLocale,
} from "./wallet-pass-content.ts";
import { getAppleWalletEnv } from "./apple-pass-env.ts";
import { createApnsClient, sendApnsUpdatePush } from "./apple-apns.ts";

/** Server kill switch: flip the NATIVE_WALLET_PASS_ENABLED secret, no rebuild needed. */
export function isNativeWalletPassServerEnabled(): boolean {
  return Deno.env.get("NATIVE_WALLET_PASS_ENABLED") === "true";
}

// ---------------------------------------------------------------------------
// Google service-account crypto (WebCrypto RS256)
// ---------------------------------------------------------------------------

type GoogleServiceAccount = { client_email: string; private_key: string };

export type GoogleWalletEnv = {
  issuerId: string;
  serviceAccount: GoogleServiceAccount;
  logoUrl: string | null;
};

/**
 * GOOGLE_WALLET_ISSUER_ID + GOOGLE_WALLET_SERVICE_ACCOUNT_JSON (raw JSON or
 * base64-encoded JSON) + optional WALLET_PASS_LOGO_URL. Returns null when the
 * feature is not configured — callers treat that as "quietly do nothing".
 */
export function getGoogleWalletEnv(): GoogleWalletEnv | null {
  const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID")?.trim();
  const rawSa = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON")?.trim();
  if (!issuerId || !rawSa) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSa.startsWith("{") ? rawSa : atob(rawSa));
  } catch {
    console.error("[wallet-pass] service account secret is not valid JSON/base64 JSON");
    return null;
  }
  const sa = parsed as Partial<GoogleServiceAccount>;
  if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    console.error("[wallet-pass] service account secret is missing client_email/private_key");
    return null;
  }
  return {
    issuerId,
    serviceAccount: { client_email: sa.client_email, private_key: sa.private_key },
    logoUrl: Deno.env.get("WALLET_PASS_LOGO_URL")?.trim() || null,
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

async function importRs256Key(privateKeyPem: string): Promise<CryptoKey> {
  const pem = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function signRs256Jwt(
  claims: Record<string, unknown>,
  serviceAccount: GoogleServiceAccount,
): Promise<string> {
  const key = await importRs256Key(serviceAccount.private_key);
  const signingInput = `${base64UrlEncodeJson({ alg: "RS256", typ: "JWT" })}.${base64UrlEncodeJson(claims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

const WALLET_OBJECTS_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

async function getGoogleAccessToken(sa: GoogleServiceAccount): Promise<string | null> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const assertion = await signRs256Jwt(
    {
      iss: sa.client_email,
      scope: WALLET_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    },
    sa,
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    // Never log the provider response body (may echo request details).
    console.error(`[wallet-pass] google token exchange failed: HTTP ${response.status}`);
    return null;
  }
  const body = (await response.json()) as { access_token?: string };
  return typeof body.access_token === "string" ? body.access_token : null;
}

/** Insert-or-replace the Generic object. Logs status codes only, never bodies. */
export async function upsertGoogleWalletObject(
  accessToken: string,
  object: Record<string, unknown>,
): Promise<boolean> {
  const objectId = String(object.id ?? "");
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  const existing = await fetch(`${WALLET_OBJECTS_BASE}/genericObject/${encodeURIComponent(objectId)}`, {
    headers,
  });
  if (existing.ok) {
    const update = await fetch(`${WALLET_OBJECTS_BASE}/genericObject/${encodeURIComponent(objectId)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(object),
    });
    if (!update.ok) console.error(`[wallet-pass] google object update failed: HTTP ${update.status}`);
    return update.ok;
  }
  if (existing.status !== 404) {
    console.error(`[wallet-pass] google object lookup failed: HTTP ${existing.status}`);
    return false;
  }
  const insert = await fetch(`${WALLET_OBJECTS_BASE}/genericObject`, {
    method: "POST",
    headers,
    body: JSON.stringify(object),
  });
  if (!insert.ok) console.error(`[wallet-pass] google object insert failed: HTTP ${insert.status}`);
  return insert.ok;
}

// ---------------------------------------------------------------------------
// Claim state → pass content
// ---------------------------------------------------------------------------

const CLAIM_ROWS_SELECT =
  "claim_status,redeemed_at,expires_at,grace_period_minutes,short_code,created_at," +
  "deals(title,title_en,title_es,title_ko,timezone,is_demo,businesses(name,address,latitude,longitude,is_demo))";

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function loadWalletPassClaimRows(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<WalletPassClaimRow[]> {
  const { data, error } = await supabaseAdmin
    .from("deal_claims")
    .select(CLAIM_ROWS_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) {
    console.error("[wallet-pass] claim rows lookup failed:", error.code ?? error.message);
    return [];
  }
  const rawRows = (data ?? []) as unknown as Record<string, unknown>[];
  return rawRows.map((raw) => {
    const deal = (Array.isArray(raw.deals) ? raw.deals[0] : raw.deals) as Record<string, unknown> | null;
    const business = deal
      ? ((Array.isArray(deal.businesses) ? deal.businesses[0] : deal.businesses) as Record<string, unknown> | null)
      : null;
    return {
      claim_status: (raw.claim_status as string | null) ?? null,
      redeemed_at: (raw.redeemed_at as string | null) ?? null,
      expires_at: String(raw.expires_at ?? ""),
      grace_period_minutes: toNumberOrNull(raw.grace_period_minutes),
      short_code: (raw.short_code as string | null) ?? null,
      created_at: String(raw.created_at ?? ""),
      deal_title: (deal?.title as string | null) ?? null,
      deal_title_en: (deal?.title_en as string | null) ?? null,
      deal_title_es: (deal?.title_es as string | null) ?? null,
      deal_title_ko: (deal?.title_ko as string | null) ?? null,
      deal_timezone: (deal?.timezone as string | null) ?? null,
      business_name: (business?.name as string | null) ?? null,
      business_address: (business?.address as string | null) ?? null,
      business_latitude: toNumberOrNull(business?.latitude),
      business_longitude: toNumberOrNull(business?.longitude),
      is_demo: deal?.is_demo === true || business?.is_demo === true,
    };
  });
}

// ---------------------------------------------------------------------------
// Issue + sync
// ---------------------------------------------------------------------------

export type IssueGoogleWalletPassResult =
  | { ok: true; saveUrl: string }
  | { ok: false; errorCode: "feature_disabled" | "not_configured" | "provider_error" };

/**
 * Ensures the user's wallet_passes row + Google object exist and are current,
 * then returns a fresh "Save to Google Wallet" URL. Used by wallet-pass-issue.
 */
export async function issueGoogleWalletPass(
  supabaseAdmin: SupabaseClient,
  userId: string,
  requestedLocale: unknown,
): Promise<IssueGoogleWalletPassResult> {
  if (!isNativeWalletPassServerEnabled()) return { ok: false, errorCode: "feature_disabled" };
  const env = getGoogleWalletEnv();
  if (!env) return { ok: false, errorCode: "not_configured" };

  const locale: WalletPassLocale = resolveWalletPassLocale(requestedLocale);
  const objectId = buildGoogleWalletObjectId(env.issuerId, userId);

  const { error: upsertError } = await supabaseAdmin.from("wallet_passes").upsert(
    {
      user_id: userId,
      google_object_id: objectId,
      pass_locale: locale,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) {
    console.error("[wallet-pass] wallet_passes upsert failed:", upsertError.code ?? upsertError.message);
    return { ok: false, errorCode: "provider_error" };
  }

  const rows = await loadWalletPassClaimRows(supabaseAdmin, userId);
  const content = buildWalletPassContent(deriveWalletPassState(rows, Date.now(), locale), locale);
  const object = buildGoogleWalletGenericObject(content, {
    issuerId: env.issuerId,
    objectId,
    logoUrl: env.logoUrl,
  });

  const accessToken = await getGoogleAccessToken(env.serviceAccount);
  if (!accessToken) return { ok: false, errorCode: "provider_error" };
  const upserted = await upsertGoogleWalletObject(accessToken, object);
  if (!upserted) return { ok: false, errorCode: "provider_error" };

  const saveJwt = await signRs256Jwt(
    buildGoogleSaveJwtClaims({
      serviceAccountEmail: env.serviceAccount.client_email,
      issuerId: env.issuerId,
      objectId,
      iatSeconds: Math.floor(Date.now() / 1000),
    }),
    env.serviceAccount,
  );
  return { ok: true, saveUrl: `https://pay.google.com/gp/v/save/${saveJwt}` };
}

/**
 * Best-effort lifecycle sync — called after claim/redeem/release/expiry writes.
 * No wallet_passes row (user never added the card) → fast no-op. NEVER throws.
 */
export async function syncWalletPassForUser(
  supabaseAdmin: SupabaseClient,
  userId: string | null | undefined,
): Promise<void> {
  try {
    if (!userId || !isNativeWalletPassServerEnabled()) return;
    const { data: passRow, error } = await supabaseAdmin
      .from("wallet_passes")
      .select("google_object_id, apple_serial_number, pass_locale")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      // Before the wallet_passes migration is applied this errors on the missing
      // table, which keeps the whole feature inert — same pattern as the owner
      // claim push in claim-deal.
      return;
    }
    if (!passRow) return;
    const locale = resolveWalletPassLocale(passRow.pass_locale);

    // --- Google: PATCH the object in place ---
    if (passRow.google_object_id) {
      const env = getGoogleWalletEnv();
      if (env) {
        const rows = await loadWalletPassClaimRows(supabaseAdmin, userId);
        const content = buildWalletPassContent(deriveWalletPassState(rows, Date.now(), locale), locale);
        const object = buildGoogleWalletGenericObject(content, {
          issuerId: env.issuerId,
          objectId: passRow.google_object_id,
          logoUrl: env.logoUrl,
        });
        const accessToken = await getGoogleAccessToken(env.serviceAccount);
        if (accessToken) await upsertGoogleWalletObject(accessToken, object);
      }
    }

    // --- Apple: bump the pass version, then push every registered device ---
    if (passRow.apple_serial_number) {
      const appleEnv = getAppleWalletEnv();
      if (appleEnv) {
        await supabaseAdmin
          .from("wallet_passes")
          .update({ updated_at: new Date().toISOString() })
          .eq("user_id", userId);
        const { data: regs } = await supabaseAdmin
          .from("wallet_pass_registrations")
          .select("id, apns_push_token")
          .eq("user_id", userId);
        const rows = (regs ?? []) as { id: string; apns_push_token: string }[];
        if (rows.length > 0) {
          const client = createApnsClient(appleEnv.certPem, appleEnv.keyPem);
          try {
            for (const r of rows) {
              const res = await sendApnsUpdatePush({
                certPem: appleEnv.certPem,
                keyPem: appleEnv.keyPem,
                passTypeId: appleEnv.passTypeId,
                deviceToken: r.apns_push_token,
                httpClient: client,
              });
              if (res.shouldUnregister) {
                await supabaseAdmin.from("wallet_pass_registrations").delete().eq("id", r.id);
              }
            }
          } finally {
            try {
              (client as { close?: () => void }).close?.();
            } catch {
              // ignore
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[wallet-pass] sync failed (non-fatal):", err instanceof Error ? err.message : "unknown");
  }
}
