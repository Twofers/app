import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { VISUAL_REDEEM_AUTO_FINALIZE_MS } from "../_shared/claim-redeem.ts";

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

    const cutoff = new Date(Date.now() - VISUAL_REDEEM_AUTO_FINALIZE_MS).toISOString();
    const nowIso = new Date().toISOString();

    const { data: updated, error: upErr } = await supabase
      .from("deal_claims")
      .update({
        redeemed_at: nowIso,
        claim_status: "redeemed",
        redeem_method: "visual",
        redeem_started_at: null,
      })
      .eq("user_id", user.id)
      .eq("claim_status", "redeeming")
      .lte("redeem_started_at", cutoff)
      .is("redeemed_at", null)
      .select("id");

    if (upErr) {
      console.error(upErr);
      return new Response(JSON.stringify({ error: "Could not finalize redemptions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, finalized_count: (updated ?? []).length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
