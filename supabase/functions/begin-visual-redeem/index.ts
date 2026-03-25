import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  finalizeStaleVisualRedeemForClaim,
  isPastRedeemDeadline,
} from "../_shared/claim-redeem.ts";

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

    let body: { claim_id?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimId = typeof body.claim_id === "string" ? body.claim_id.trim() : "";
    if (!claimId) {
      return new Response(JSON.stringify({ error: "Missing claim_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    await finalizeStaleVisualRedeemForClaim(supabase, claimId, nowIso);

    const { data: claim, error: fetchErr } = await supabase
      .from("deal_claims")
      .select("id, user_id, expires_at, redeemed_at, claim_status, redeem_started_at, grace_period_minutes")
      .eq("id", claimId)
      .maybeSingle();

    if (fetchErr || !claim) {
      return new Response(JSON.stringify({ error: "Claim not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (claim.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "This claim does not belong to you" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (claim.redeemed_at) {
      return new Response(JSON.stringify({ error: "This claim has already been redeemed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const grace = typeof claim.grace_period_minutes === "number" && claim.grace_period_minutes > 0
      ? claim.grace_period_minutes
      : 10;

    if (isPastRedeemDeadline(now.getTime(), claim.expires_at as string, grace)) {
      await supabase.from("deal_claims").update({ claim_status: "expired" }).eq("id", claimId);
      return new Response(JSON.stringify({ error: "This claim has expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status = claim.claim_status as string;
    const started = claim.redeem_started_at ? new Date(claim.redeem_started_at as string) : null;

    if (status === "redeeming" && started) {
      const minComplete = new Date(started.getTime() + 15 * 1000);
      return new Response(
        JSON.stringify({
          ok: true,
          resumed: true,
          server_now: nowIso,
          redeem_started_at: claim.redeem_started_at,
          min_complete_at: minComplete.toISOString(),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (status !== "active") {
      return new Response(JSON.stringify({ error: "This claim cannot be used right now" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: updatedRows, error: upErr } = await supabase
      .from("deal_claims")
      .update({ claim_status: "redeeming", redeem_started_at: nowIso })
      .eq("id", claimId)
      .eq("user_id", user.id)
      .eq("claim_status", "active")
      .is("redeemed_at", null)
      .select("id");

    if (upErr || !updatedRows?.length) {
      console.error(upErr);
      return new Response(JSON.stringify({ error: "Could not start redemption. Try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const minComplete = new Date(now.getTime() + 15 * 1000);
    return new Response(
      JSON.stringify({
        ok: true,
        resumed: false,
        server_now: nowIso,
        redeem_started_at: nowIso,
        min_complete_at: minComplete.toISOString(),
      }),
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
