import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { hashPin, normalizePin, verifyPin } from "../_shared/redemption-crypto.ts";
import { pinRotationRequiresCurrentPin } from "../_shared/owner-pin-policy.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

type SecurityRow = {
  business_id: string;
  enabled: boolean;
  pin_hash: string | null;
  pin_failed_attempts: number | null;
  pin_locked_until: string | null;
};

function json(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function failPin(
  supabaseAdmin: SupabaseClient,
  businessId: string,
  row: SecurityRow,
  corsHeaders: Record<string, string>,
) {
  const now = new Date();
  const nextAttempts = Number(row.pin_failed_attempts ?? 0) + 1;
  const nextLockedUntil =
    nextAttempts >= MAX_PIN_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MS).toISOString() : null;

  await supabaseAdmin
    .from("owner_redemption_security")
    .update({
      pin_failed_attempts: nextAttempts,
      pin_locked_until: nextLockedUntil,
      updated_at: now.toISOString(),
    })
    .eq("business_id", businessId);

  return json(
    {
      ok: false,
      error: "Incorrect redemption PIN.",
      error_code: nextLockedUntil ? "PIN_LOCKED" : "PIN_INCORRECT",
      locked_until: nextLockedUntil,
    },
    nextLockedUntil ? 429 : 403,
    corsHeaders,
  );
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
    const serviceKey = getServiceRoleKey();
    const supabaseUser = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized. Please log in as the business owner." }, 401, corsHeaders);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: { action?: unknown; business_id?: unknown; pin?: unknown; new_pin?: unknown; current_pin?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON in request body" }, 400, corsHeaders);
    }

    const action = cleanText(body.action, 32);
    const businessId = cleanText(body.business_id, 80);
    if (!["status", "enable", "disable", "verify", "change"].includes(action)) {
      return json({ error: "Invalid owner redemption security action." }, 400, corsHeaders);
    }
    if (!UUID_RE.test(businessId)) {
      return json({ error: "Missing or invalid business_id" }, 400, corsHeaders);
    }

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("id,owner_id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (businessError || !business) {
      return json({ error: "You do not own this business." }, 403, corsHeaders);
    }

    const { data: rowData, error: rowError } = await supabaseAdmin
      .from("owner_redemption_security")
      .select("business_id,enabled,pin_hash,pin_failed_attempts,pin_locked_until")
      .eq("business_id", businessId)
      .maybeSingle();

    if (rowError) {
      console.error("[owner-redemption-security] status lookup failed", rowError);
      return json({ error: "Could not load redemption PIN settings." }, 500, corsHeaders);
    }

    const row = rowData as SecurityRow | null;
    if (action === "status") {
      return json(
        {
          ok: true,
          enabled: row?.enabled === true,
          has_pin: Boolean(row?.pin_hash),
          locked_until: row?.pin_locked_until ?? null,
        },
        200,
        corsHeaders,
      );
    }

    const now = new Date();
    if (row?.pin_locked_until && new Date(row.pin_locked_until).getTime() > now.getTime()) {
      return json(
        {
          ok: false,
          error: "Too many incorrect PIN attempts. Try again later.",
          error_code: "PIN_LOCKED",
          locked_until: row.pin_locked_until,
        },
        429,
        corsHeaders,
      );
    }

    if (action === "enable") {
      const pin = normalizePin(body.pin);
      if (!pin) {
        return json({ error: "Redemption PIN must be 4 to 6 digits." }, 400, corsHeaders);
      }
      // A stored hash means a PIN is already set: rotating it requires the
      // current PIN. Missing and wrong current PIN return the exact failed-verify
      // shape (and count toward its lockout) so there is no oracle.
      if (pinRotationRequiresCurrentPin(row)) {
        const currentPin = normalizePin(body.current_pin);
        if (!currentPin || !(await verifyPin(currentPin, row!.pin_hash as string))) {
          return failPin(supabaseAdmin, businessId, row!, corsHeaders);
        }
      }
      const pinHash = await hashPin(pin);
      const nowIso = now.toISOString();
      const { error: upsertError } = await supabaseAdmin
        .from("owner_redemption_security")
        .upsert(
          {
            business_id: businessId,
            owner_id: user.id,
            enabled: true,
            pin_hash: pinHash,
            pin_failed_attempts: 0,
            pin_locked_until: null,
            updated_at: nowIso,
            updated_by: user.id,
          },
          { onConflict: "business_id" },
        );

      if (upsertError) {
        console.error("[owner-redemption-security] enable failed", upsertError);
        return json({ error: "Could not enable redemption PIN." }, 500, corsHeaders);
      }
      return json({ ok: true, enabled: true, unlocked: true }, 200, corsHeaders);
    }

    if (action === "verify") {
      if (!row?.enabled) {
        return json({ ok: true, enabled: false, unlocked: true }, 200, corsHeaders);
      }
      const pin = normalizePin(body.pin);
      if (!pin || !row.pin_hash) {
        return json({ error: "Enter the 4-6 digit redemption PIN." }, 400, corsHeaders);
      }
      if (!(await verifyPin(pin, row.pin_hash))) {
        return failPin(supabaseAdmin, businessId, row, corsHeaders);
      }
      await supabaseAdmin
        .from("owner_redemption_security")
        .update({ pin_failed_attempts: 0, pin_locked_until: null, updated_at: now.toISOString() })
        .eq("business_id", businessId);
      return json({ ok: true, enabled: true, unlocked: true }, 200, corsHeaders);
    }

    if (action === "change") {
      const pin = normalizePin(body.pin);
      const newPin = normalizePin(body.new_pin);
      if (!row?.enabled || !row.pin_hash) {
        return json({ error: "Owner redemption PIN is not enabled." }, 400, corsHeaders);
      }
      if (!pin) {
        return json({ error: "Enter the current redemption PIN." }, 400, corsHeaders);
      }
      if (!newPin) {
        return json({ error: "New redemption PIN must be 4 to 6 digits." }, 400, corsHeaders);
      }
      if (!(await verifyPin(pin, row.pin_hash))) {
        return failPin(supabaseAdmin, businessId, row, corsHeaders);
      }

      const { error: changeError } = await supabaseAdmin
        .from("owner_redemption_security")
        .update({
          pin_hash: await hashPin(newPin),
          pin_failed_attempts: 0,
          pin_locked_until: null,
          updated_at: now.toISOString(),
          updated_by: user.id,
        })
        .eq("business_id", businessId);

      if (changeError) {
        console.error("[owner-redemption-security] change failed", changeError);
        return json({ error: "Could not change redemption PIN." }, 500, corsHeaders);
      }
      return json({ ok: true, enabled: true, unlocked: true }, 200, corsHeaders);
    }

    if (action === "disable" && row?.enabled && row.pin_hash) {
      const pin = normalizePin(body.pin);
      if (!pin) {
        return json({ error: "Enter the 4-6 digit redemption PIN to turn this off." }, 400, corsHeaders);
      }
      if (!(await verifyPin(pin, row.pin_hash))) {
        return failPin(supabaseAdmin, businessId, row, corsHeaders);
      }
    }

    const { error: disableError } = await supabaseAdmin
      .from("owner_redemption_security")
      .upsert(
        {
          business_id: businessId,
          owner_id: user.id,
          enabled: false,
          // Clear the hash so a disabled business holds no dormant PIN:
          // re-enabling is a fresh setup, and "hash exists" always means
          // "rotation requires the current PIN" (see enable above).
          pin_hash: null,
          pin_failed_attempts: 0,
          pin_locked_until: null,
          updated_at: now.toISOString(),
          updated_by: user.id,
        },
        { onConflict: "business_id" },
      );

    if (disableError) {
      console.error("[owner-redemption-security] disable failed", disableError);
      return json({ error: "Could not disable redemption PIN." }, 500, corsHeaders);
    }
    return json({ ok: true, enabled: false, unlocked: true }, 200, corsHeaders);
  } catch (err) {
    console.error("[owner-redemption-security] unexpected error", err);
    return json({ error: "Server error" }, 500, corsHeaders);
  }
});
