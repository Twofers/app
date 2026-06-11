import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  failedStaffAttemptReason,
  isStaffRedemptionLockedOut,
  STAFF_LOCKOUT_WINDOW_MS,
} from "../_shared/staff-redemption-lockout.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // 🔒 Brute-force lockout (Batch 6 parity, scoped per counter device — the
    // device id is a server-set app_metadata claim). >= 10 recorded failures
    // in the last 5 minutes → 429 before any code lookup happens.
    const businessId = metadataUuid(user.app_metadata, "business_id");
    const deviceId = metadataUuid(user.app_metadata, "redemption_device_id");
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

    const rpcName = action === "confirm" ? "confirm_staff_redemption" : "preview_staff_redemption";
    const { data, error } = await supabase.rpc(rpcName, {
      p_token: typeof body.token === "string" ? body.token : null,
      p_short_code: typeof body.short_code === "string" ? body.short_code : null,
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

    return json(result, 200, corsHeaders);
  } catch (err) {
    console.error("[staff-redemption] unexpected error", err);
    return json({ error: "Server error" }, 500, corsHeaders);
  }
});
