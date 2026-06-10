import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { normalizePin, verifyExitToken, verifyPin } from "../_shared/redemption-crypto.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

function json(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: { device_id?: unknown; exit_token?: unknown; pin?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON in request body" }, 400, corsHeaders);
    }

    const deviceId = typeof body.device_id === "string" ? body.device_id.trim() : "";
    const exitToken = typeof body.exit_token === "string" ? body.exit_token.trim() : "";
    const pin = normalizePin(body.pin);

    if (!UUID_RE.test(deviceId) || !exitToken || !pin) {
      return json({ error: "Missing device exit credentials." }, 400, corsHeaders);
    }

    const { data: device, error: fetchError } = await supabaseAdmin
      .from("redemption_devices")
      .select("id,pin_hash,exit_token_hash,pin_failed_attempts,pin_locked_until,active,removed_at")
      .eq("id", deviceId)
      .maybeSingle();

    if (fetchError || !device || device.removed_at) {
      return json({ error: "Device is not active." }, 404, corsHeaders);
    }

    const now = new Date();
    const lockedUntil = device.pin_locked_until ? new Date(device.pin_locked_until as string) : null;
    if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
      return json(
        {
          error: "Too many incorrect PIN attempts. Try again later.",
          error_code: "PIN_LOCKED",
          locked_until: lockedUntil.toISOString(),
        },
        429,
        corsHeaders,
      );
    }

    if (!(await verifyExitToken(exitToken, String(device.exit_token_hash)))) {
      return json({ error: "Device exit credentials are invalid." }, 401, corsHeaders);
    }

    if (!(await verifyPin(pin, String(device.pin_hash)))) {
      const nextAttempts = Number(device.pin_failed_attempts ?? 0) + 1;
      const nextLockedUntil =
        nextAttempts >= MAX_PIN_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS).toISOString() : null;
      await supabaseAdmin
        .from("redemption_devices")
        .update({
          pin_failed_attempts: nextAttempts,
          pin_locked_until: nextLockedUntil,
          updated_at: now.toISOString(),
        })
        .eq("id", deviceId);

      return json(
        {
          error: "Incorrect exit PIN.",
          error_code: nextLockedUntil ? "PIN_LOCKED" : "PIN_INCORRECT",
          locked_until: nextLockedUntil,
        },
        nextLockedUntil ? 429 : 403,
        corsHeaders,
      );
    }

    const nowIso = now.toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("redemption_devices")
      .update({
        active: false,
        deactivated_at: nowIso,
        pin_failed_attempts: 0,
        pin_locked_until: null,
        updated_at: nowIso,
      })
      .eq("id", deviceId);

    if (updateError) {
      console.error("[exit-redemption-mode] update failed", updateError);
      return json({ error: "Could not exit Redemption Mode." }, 500, corsHeaders);
    }

    return json({ ok: true }, 200, corsHeaders);
  } catch (err) {
    console.error("[exit-redemption-mode] unexpected error", err);
    return json({ error: "Server error" }, 500, corsHeaders);
  }
});
