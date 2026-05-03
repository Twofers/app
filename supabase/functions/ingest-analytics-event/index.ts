import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const ALLOWED = new Set([
  "deal_viewed",
  "deal_opened",
  "deal_claimed",
  "wallet_opened",
  "redeem_started",
  "redeem_completed",
  "redeem_failed",
  "claim_expired",
  "claim_blocked",
]);

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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const ctx = body.context && typeof body.context === "object" && !Array.isArray(body.context)
      ? body.context
      : {};

    const { error: insErr } = await supabase.from("app_analytics_events").insert({
      event_name: eventName,
      user_id: user.id,
      business_id: body.business_id ?? null,
      deal_id: body.deal_id ?? null,
      claim_id: body.claim_id ?? null,
      context: ctx,
      app_version: body.app_version ?? null,
      device_platform: body.device_platform ?? null,
    });

    if (insErr) {
      console.error(insErr);
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
    console.error(err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
