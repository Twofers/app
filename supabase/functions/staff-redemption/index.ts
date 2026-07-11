import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  failedStaffAttemptReason,
  isStaffRedemptionLockedOut,
  STAFF_LOCKOUT_WINDOW_MS,
} from "../_shared/staff-redemption-lockout.ts";
import { parseShortCodeScanValue } from "../_shared/wallet-pass-content.ts";
import { syncWalletPassForUser } from "../_shared/wallet-pass-sync.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEW_STAFF_PREFLIGHT_COLUMN_NAMES = ["location_id", "qr_token_hash"] as const;

function json(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function metadataUuid(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function statusCode(status: unknown): number {
  switch (status) {
    case "unauthorized":
      return 401;
    case "not_found":
      return 404;
    case "already_redeemed":
    case "not_redeemable":
      return 409;
    case "expired":
      return 410;
    case "deal_inactive":
    case "invalid_input":
      return 400;
    default:
      return 400;
  }
}

function isMissingStaffPreflightColumn(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST200" || error?.code === "PGRST204" || error?.code === "42703") &&
    NEW_STAFF_PREFLIGHT_COLUMN_NAMES.some((name) => message.includes(name))
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    /** Service role — failed_redeem_attempts is RLS default-deny (service role only). */
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized. Please log in." }, 401, corsHeaders);
    }
    if (!isRedeemerUser(user)) {
      return json({ error: "This endpoint is only for Redemption Mode staff sessions." }, 403, corsHeaders);
    }

    let body: { action?: unknown; token?: unknown; short_code?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON in request body" }, 400, corsHeaders);
    }

    const action = body.action === "confirm" ? "confirm" : body.action === "preview" ? "preview" : null;
    if (!action) {
      return json({ error: "Missing action." }, 400, corsHeaders);
    }

    let shortCodeNorm =
      typeof body.short_code === "string"
        ? body.short_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
        : "";
    let tokenNorm = typeof body.token === "string" ? body.token.trim() : "";
    // Native wallet-pass barcodes encode the short code (twofer://redeem/sc/<CODE>).
    // Staff scanners forward raw scans as `token`; treat those as short-code entry
    // so pass scans ride the existing rate-limited short-code path.
    const walletScanShortCode = shortCodeNorm.length === 0 ? parseShortCodeScanValue(tokenNorm) : null;
    if (walletScanShortCode) {
      shortCodeNorm = walletScanShortCode;
      tokenNorm = "";
    }

    // 🔒 Brute-force lockout (Batch 6 parity, scoped per counter device — the
    // device id is a server-set app_metadata claim). >= 10 recorded failures
    // in the last 5 minutes → 429 before any code lookup happens.
    const businessId = metadataUuid(user.app_metadata, "business_id");
    const deviceId = metadataUuid(user.app_metadata, "redemption_device_id");
    let scannerLocationId = metadataUuid(user.app_metadata, "location_id");
    if (!scannerLocationId && deviceId) {
      const { data: deviceRow } = await supabaseAdmin
        .from("redemption_devices")
        .select("location_id")
        .eq("id", deviceId)
        .maybeSingle();
      scannerLocationId = (deviceRow?.location_id as string | null | undefined) ?? null;
    }
    if (businessId && deviceId) {
      const windowStart = new Date(Date.now() - STAFF_LOCKOUT_WINDOW_MS).toISOString();
      const { count: recentFailures, error: lockoutErr } = await supabaseAdmin
        .from("failed_redeem_attempts")
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("redemption_device_id", deviceId)
        .gte("attempted_at", windowStart);
      if (lockoutErr) {
        console.error("[staff-redemption] lockout check failed", lockoutErr);
      } else if (isStaffRedemptionLockedOut(recentFailures)) {
        return json({ error: "Too many failed attempts. Try again in a few minutes." }, 429, corsHeaders);
      }
    }

    const emptyClaimId = "00000000-0000-0000-0000-000000000000";
    const claimSelectNew = "id, user_id, short_code, location_id, deal:deals!inner(is_demo,business_id,location_id)";
    const claimSelectLegacy = "id, user_id, short_code, deal:deals!inner(is_demo,business_id)";
    const tokenHash = tokenNorm.length > 0 ? await sha256Base64Url(tokenNorm) : "";
    const runPreflight = (selectColumns: string, match: "short_code" | "qr_token_hash" | "token" | "none") => {
      let query = supabaseAdmin.from("deal_claims").select(selectColumns).limit(1);
      if (match === "short_code") return query.eq("short_code", shortCodeNorm);
      if (match === "qr_token_hash") return query.eq("qr_token_hash", tokenHash);
      if (match === "token") return query.eq("token", tokenNorm);
      return query.eq("id", emptyClaimId);
    };
    const preflightMatch =
      shortCodeNorm.length >= 4 ? "short_code" : tokenNorm.length > 0 ? "qr_token_hash" : "none";
    let preflightResult = (await runPreflight(claimSelectNew, preflightMatch)) as {
      data: unknown[] | null;
      error: { code?: string | null; message?: string | null } | null;
    };
    if (
      !preflightResult.error &&
      tokenNorm.length > 0 &&
      preflightMatch === "qr_token_hash" &&
      (preflightResult.data?.length ?? 0) === 0
    ) {
      preflightResult = (await runPreflight(claimSelectNew, "token")) as {
        data: unknown[] | null;
        error: { code?: string | null; message?: string | null } | null;
      };
    }
    if (isMissingStaffPreflightColumn(preflightResult.error)) {
      const legacyMatch =
        shortCodeNorm.length >= 4 ? "short_code" : tokenNorm.length > 0 ? "token" : "none";
      preflightResult = (await runPreflight(claimSelectLegacy, legacyMatch)) as {
        data: unknown[] | null;
        error: { code?: string | null; message?: string | null } | null;
      };
    }
    const { data: preflightRows, error: preflightError } = preflightResult;
    if (preflightError) {
      console.error("[staff-redemption] preflight failed", preflightError);
      return json({ error: "Could not process redemption." }, 500, corsHeaders);
    }
    const preflightRow = preflightRows?.[0] as {
      id?: string | null;
      user_id?: string | null;
      short_code?: string | null;
      location_id?: string | null;
      deal?: { is_demo?: boolean | null; business_id?: string | null; location_id?: string | null } | null;
    } | undefined;
    if (preflightRow?.deal?.is_demo === true) {
      return json({ error: "This is sample content for testing only. Not a real offer." }, 400, corsHeaders);
    }
    if (preflightRow?.deal?.business_id && businessId && preflightRow.deal.business_id !== businessId) {
      return json(
        {
          error: "This deal belongs to another business and cannot be redeemed here.",
          error_code: "WRONG_BUSINESS_REDEMPTION",
        },
        403,
        corsHeaders,
      );
    }
    const dealLocationId = preflightRow?.deal?.location_id ?? preflightRow?.location_id ?? null;
    if (dealLocationId && scannerLocationId && dealLocationId !== scannerLocationId) {
      return json(
        {
          error: "This deal can only be redeemed at the location shown in the customer's wallet.",
          error_code: "WRONG_LOCATION_REDEMPTION",
        },
        403,
        corsHeaders,
      );
    }

    const rpcName = action === "confirm" ? "confirm_staff_redemption" : "preview_staff_redemption";
    const rpcShortCode =
      typeof body.short_code === "string"
        ? body.short_code
        : walletScanShortCode
          ? walletScanShortCode
          : tokenNorm.length > 0 && preflightRow?.short_code
            ? preflightRow.short_code
            : null;
    const { data, error } = await supabase.rpc(rpcName, {
      p_token: rpcShortCode ? null : typeof body.token === "string" ? body.token : null,
      p_short_code: rpcShortCode,
    });

    if (error) {
      console.error("[staff-redemption] rpc failed", error);
      return json({ error: "Could not process redemption." }, 500, corsHeaders);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") {
      return json({ error: "Could not process redemption." }, 500, corsHeaders);
    }

    const result = row as Record<string, unknown>;
    if (result.ok !== true) {
      // Best-effort failure log feeding the lockout above. Counts only real
      // guesses (unknown/expired codes); honest already-redeemed re-scans and
      // input errors never count. Never blocks the response.
      const reason = failedStaffAttemptReason(result.status);
      if (reason && businessId && deviceId) {
        try {
          const { error: insErr } = await supabaseAdmin.from("failed_redeem_attempts").insert({
            business_id: businessId,
            redemption_device_id: deviceId,
            user_id: user.id,
            reason,
          });
          if (insErr) console.error("[staff-redemption] failed-attempt insert error", insErr);
        } catch (err) {
          console.error("[staff-redemption] failed-attempt insert threw", err);
        }
      }
      return json({ ...result, error: String(result.message ?? "Redemption failed.") }, statusCode(result.status), corsHeaders);
    }

    if (action === "confirm" && tokenNorm.length > 0 && preflightRow?.id) {
      await supabaseAdmin
        .from("redemptions")
        .update({ redeem_method: "staff_qr", code_type: "token" })
        .eq("claim_id", preflightRow.id);
    }

    if (action === "confirm") {
      // Native wallet pass: flip the customer's Twofer Card to "Redeemed".
      // Best-effort and flag-gated; a no-op until the customer added the card.
      await syncWalletPassForUser(supabaseAdmin, preflightRow?.user_id ?? null);
    }

    return json(result, 200, corsHeaders);
  } catch (err) {
    console.error("[staff-redemption] unexpected error", err);
    return json({ error: "Server error" }, 500, corsHeaders);
  }
});
