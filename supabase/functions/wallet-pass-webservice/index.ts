/**
 * Native wallet pass ("Twofer Card") — Apple PassKit Web Service.
 * Implements the REST protocol Apple calls to keep the pass fresh:
 *   POST   /v1/devices/{dlid}/registrations/{ptid}/{serial}   register device
 *   DELETE /v1/devices/{dlid}/registrations/{ptid}/{serial}   unregister
 *   GET    /v1/devices/{dlid}/registrations/{ptid}?passesUpdatedSince=tag
 *   GET    /v1/passes/{ptid}/{serial}                         latest signed pass
 *   POST   /v1/log                                            device logs
 * Auth (register/unregister/get-pass) is `Authorization: ApplePass <token>`,
 * verified against the HMAC-derived per-user token. No Supabase JWT (verify_jwt
 * is off) — Apple's servers call this directly.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  deriveAppleAuthToken,
  parseApplePassAuthHeader,
  timingSafeEqualStrings,
} from "../_shared/apple-pass-auth.ts";
import { buildAppleWalletPassBytes } from "../_shared/apple-wallet-issue.ts";
import { isNativeWalletPassServerEnabled } from "../_shared/wallet-pass-sync.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = getServiceRoleKey();
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);
  // Keying material for the ApplePass tokens, deliberately NOT the resolved service-role
  // key above. Tokens are HMAC-derived at issue time from the legacy env var (see
  // _shared/apple-wallet-issue.ts) and their hashes are already stored in wallet_passes,
  // so verification has to use that same secret or every existing pass fails auth.
  const walletAuthSecret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/wallet-pass-webservice/, "");
  const method = req.method.toUpperCase();

  const text = (body: string, status: number) => new Response(body, { status });
  const empty = (status: number) => new Response(null, { status });

  // POST /v1/log — swallow (never authenticated); useful for debugging on device.
  if (method === "POST" && /^\/v1\/log$/.test(path)) {
    try {
      const body = await req.json();
      console.log("[wallet-pass-webservice] device log:", JSON.stringify(body).slice(0, 500));
    } catch {
      // ignore
    }
    return empty(200);
  }

  if (!isNativeWalletPassServerEnabled()) return empty(503);

  /** serial → user_id, only if the ApplePass token authenticates. */
  async function authUserForSerial(serial: string): Promise<string | null> {
    const presented = parseApplePassAuthHeader(req.headers.get("Authorization"));
    if (!presented) return null;
    const { data } = await supabaseAdmin
      .from("wallet_passes")
      .select("user_id")
      .eq("apple_serial_number", serial)
      .maybeSingle();
    const userId = data?.user_id as string | null | undefined;
    if (!userId) return null;
    const expected = await deriveAppleAuthToken(walletAuthSecret, userId);
    return timingSafeEqualStrings(presented, expected) ? userId : null;
  }

  const regMatch = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([^/]+)$/);
  const listMatch = path.match(/^\/v1\/devices\/([^/]+)\/registrations\/([^/]+)$/);
  const passMatch = path.match(/^\/v1\/passes\/([^/]+)\/([^/]+)$/);

  // Register a device for updates.
  if (method === "POST" && regMatch) {
    const [, dlid, , serial] = regMatch;
    const userId = await authUserForSerial(serial);
    if (!userId) return empty(401);
    let pushToken = "";
    try {
      pushToken = (await req.json())?.pushToken ?? "";
    } catch {
      return text("bad body", 400);
    }
    if (!pushToken) return text("missing pushToken", 400);
    const { data: existing } = await supabaseAdmin
      .from("wallet_pass_registrations")
      .select("id")
      .eq("user_id", userId)
      .eq("device_library_identifier", dlid)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("wallet_pass_registrations").upsert(
      { user_id: userId, device_library_identifier: dlid, apns_push_token: pushToken },
      { onConflict: "user_id,device_library_identifier" },
    );
    if (error) {
      console.error("[wallet-pass-webservice] register failed:", error.code ?? error.message);
      return empty(500);
    }
    return empty(existing ? 200 : 201);
  }

  // Unregister a device.
  if (method === "DELETE" && regMatch) {
    const [, dlid, , serial] = regMatch;
    const userId = await authUserForSerial(serial);
    if (!userId) return empty(401);
    await supabaseAdmin
      .from("wallet_pass_registrations")
      .delete()
      .eq("user_id", userId)
      .eq("device_library_identifier", dlid);
    return empty(200);
  }

  // List serials updated since the tag (no ApplePass auth on this call).
  if (method === "GET" && listMatch) {
    const [, dlid] = listMatch;
    const since = url.searchParams.get("passesUpdatedSince");
    const { data: regs } = await supabaseAdmin
      .from("wallet_pass_registrations")
      .select("user_id")
      .eq("device_library_identifier", dlid);
    const userIds = (regs ?? []).map((r: { user_id: string }) => r.user_id);
    if (userIds.length === 0) return empty(204);
    let q = supabaseAdmin
      .from("wallet_passes")
      .select("apple_serial_number, updated_at")
      .in("user_id", userIds)
      .not("apple_serial_number", "is", null);
    if (since) q = q.gt("updated_at", since);
    const { data: passes } = await q;
    const rows = (passes ?? []) as { apple_serial_number: string; updated_at: string }[];
    if (rows.length === 0) return empty(204);
    const lastUpdated = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), rows[0].updated_at);
    return new Response(
      JSON.stringify({ lastUpdated, serialNumbers: rows.map((r) => r.apple_serial_number) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Serve the latest signed pass.
  if (method === "GET" && passMatch) {
    const [, , serial] = passMatch;
    const userId = await authUserForSerial(serial);
    if (!userId) return empty(401);
    const { data: passRow } = await supabaseAdmin
      .from("wallet_passes")
      .select("pass_locale, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    const updatedAt = passRow?.updated_at as string | undefined;
    const ims = req.headers.get("If-Modified-Since");
    if (ims && updatedAt && new Date(updatedAt).getTime() <= new Date(ims).getTime()) {
      return empty(304);
    }
    const bytes = await buildAppleWalletPassBytes(
      supabaseAdmin,
      userId,
      serial,
      (passRow?.pass_locale as string | undefined) ?? "en",
    );
    if (!bytes) return empty(500);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        ...(updatedAt ? { "Last-Modified": new Date(updatedAt).toUTCString() } : {}),
      },
    });
  }

  return empty(404);
});
