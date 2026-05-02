import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

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

  // Dev-only gate. Multiple defenses so a single misconfigured env var can't open this in prod:
  //   1. Production env flag must NOT be set.
  //   2. BILLING_SIMULATE_SUBSCRIBE must be true.
  //   3. The caller must supply a shared secret header that matches BILLING_SIMULATE_SUBSCRIBE_SECRET.
  if (Deno.env.get("ENVIRONMENT") === "production") {
    return new Response(JSON.stringify({ error: "Not available in production." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (Deno.env.get("BILLING_SIMULATE_SUBSCRIBE") !== "true") {
    return new Response(JSON.stringify({ error: "Not enabled." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const expectedSecret = Deno.env.get("BILLING_SIMULATE_SUBSCRIBE_SECRET");
  if (!expectedSecret || expectedSecret.length < 16) {
    // Refuse to run if the shared secret isn't set to something non-trivial.
    return new Response(JSON.stringify({ error: "Server misconfigured." }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.headers.get("x-simulate-subscribe-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Forbidden." }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trialEndsAtIso = new Date(Date.now() + 30 * 86400000).toISOString();

    // Update the canonical subscription fields.
    await supabase
      .from("business_profiles")
      .update({
        subscription_status: "active",
        subscription_tier: "premium",
        trial_ends_at: null,
        current_period_ends_at: trialEndsAtIso,
      })
      .or(`user_id.eq.${user.id},owner_id.eq.${user.id}`);

    // Keep legacy field in sync (some UI still reads from `businesses`).
    await supabase
      .from("businesses")
      .update({ subscription_tier: "premium" })
      .eq("owner_id", user.id);

    console.log("[simulate-subscribe] upgraded user", user.id, "to premium/active");

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[simulate-subscribe] error:", err);
    return new Response(JSON.stringify({ error: "Failed to simulate subscription." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

