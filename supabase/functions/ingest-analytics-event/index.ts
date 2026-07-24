import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

const ALLOWED = new Set([
  "app_opened",
  "signup_started",
  "signup_completed",
  "role_selected",
  "onboarding_completed",
  "location_permission_allowed",
  "location_permission_denied",
  "deal_viewed",
  "deal_opened",
  "shop_viewed",
  "favorite_added",
  "favorite_removed",
  "alert_opt_in_accepted",
  "alert_opt_in_declined",
  "deal_claimed",
  "deal_redeemed",
  "wallet_opened",
  "redeem_started",
  "redeem_completed",
  "redeem_failed",
  "business_deal_created",
  "claim_expired",
  "claim_blocked",
  "quick_deal_preview_blocked",
  "quick_deal_release_blocked",
  "quick_deal_offer_definition_fallback_used",
  "ai_ad_quality_gate_failed",
  "ai_ad_versioned_publish",
  "app_error",
]);

const PRE_AUTH_ALLOWED = new Set([
  "app_opened",
  "signup_started",
  "signup_completed",
  "app_error",
]);

const SENSITIVE_CONTEXT_KEY_RE =
  /(email|address|phone|token|secret|password|invite|qr|url|uri|lat|lng|latitude|longitude)/i;

function sanitizeContext(input: unknown): Record<string, string | number | boolean | null> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (SENSITIVE_CONTEXT_KEY_RE.test(key)) continue;
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      out[key] = value ?? null;
    } else if (typeof value === "string" && value.length <= 120 && !value.includes("@")) {
      out[key] = value;
    }
  }
  return out;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = getServiceRoleKey();

    let body: {
      event_name?: string;
      business_id?: string | null;
      deal_id?: string | null;
      claim_id?: string | null;
      context?: Record<string, unknown>;
      app_version?: string | null;
      device_platform?: string | null;
    };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventName = typeof body.event_name === "string" ? body.event_name.trim() : "";
    if (!eventName || !ALLOWED.has(eventName)) {
      return new Response(JSON.stringify({ error: "Invalid or unsupported event_name" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if ((userError || !user) && !PRE_AUTH_ALLOWED.has(eventName)) {
      return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (user && isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    const ctx = sanitizeContext(body.context);

    const { error: insErr } = await supabase.from("app_analytics_events").insert({
      event_name: eventName,
      user_id: user?.id ?? null,
      business_id: body.business_id ?? null,
      deal_id: body.deal_id ?? null,
      claim_id: body.claim_id ?? null,
      context: ctx,
      app_version: body.app_version ?? null,
      device_platform: body.device_platform ?? null,
    });

    if (insErr) {
      // Daily impression idempotency: a partial unique index collapses repeat
      // `deal_viewed` rows (same user + device_platform + deal + UTC day). A unique
      // violation here means the impression is already counted — treat it as success.
      if (eventName === "deal_viewed" && insErr.code === "23505") {
        return new Response(JSON.stringify({ ok: true, deduped: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Log code + message only — the full Postgres error object can echo
      // attempted column values into platform logs, outside the
      // sanitizeContext redaction boundary (audit F-016).
      console.error("[ingest-analytics-event] insert failed:", insErr.code ?? "", insErr.message ?? "");
      return new Response(JSON.stringify({ error: "Could not record event" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Message only, never the raw object (may carry headers/payload fragments).
    console.error("[ingest-analytics-event] error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
