import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Dev-only gate (must be explicitly enabled).
  if (Deno.env.get("BILLING_SIMULATE_SUBSCRIBE") !== "true") {
    return new Response(JSON.stringify({ error: "Not enabled." }), {
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

