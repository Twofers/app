import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  finalizeStaleVisualRedeemForClaim,
  isPastRedeemDeadline,
} from "../_shared/claim-redeem.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const MIN_MS = 14_000;
const MAX_MS = 120_000;

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
      .select("id, user_id, deal_id, expires_at, redeemed_at, claim_status, redeem_started_at, grace_period_minutes")
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
      return new Response(
        JSON.stringify({
          ok: true,
          already_redeemed: true,
          redeemed_at: claim.redeemed_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const grace = typeof claim.grace_period_minutes === "number" && claim.grace_period_minutes > 0
      ? claim.grace_period_minutes
      : 10;

    if (isPastRedeemDeadline(now.getTime(), claim.expires_at as string, grace)) {
      await supabase
        .from("deal_claims")
        .update({ claim_status: "expired", redeem_started_at: null })
        .eq("id", claimId);
      return new Response(JSON.stringify({ error: "This claim has expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (claim.claim_status !== "redeeming" || !claim.redeem_started_at) {
      return new Response(JSON.stringify({ error: "Redemption was not started for this claim" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const started = new Date(claim.redeem_started_at as string);
    const elapsed = now.getTime() - started.getTime();
    if (elapsed < MIN_MS) {
      return new Response(JSON.stringify({ error: "Redemption window has not finished yet" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (elapsed > MAX_MS) {
      await finalizeStaleVisualRedeemForClaim(supabase, claimId, nowIso);
      const { data: again } = await supabase
        .from("deal_claims")
        .select("redeemed_at")
        .eq("id", claimId)
        .maybeSingle();
      if (again?.redeemed_at) {
        return new Response(
          JSON.stringify({
            ok: true,
            already_redeemed: true,
            redeemed_at: again.redeemed_at,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "Redemption session could not be completed" }), {
        status: 408,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: updated, error: upErr } = await supabase
      .from("deal_claims")
      .update({
        redeemed_at: nowIso,
        claim_status: "redeemed",
        redeem_method: "visual",
        redeem_started_at: null,
      })
      .eq("id", claimId)
      .eq("user_id", user.id)
      .eq("claim_status", "redeeming")
      .is("redeemed_at", null)
      .select("redeemed_at")
      .maybeSingle();

    if (upErr || !updated) {
      const { data: again } = await supabase
        .from("deal_claims")
        .select("redeemed_at")
        .eq("id", claimId)
        .maybeSingle();
      if (again?.redeemed_at) {
        return new Response(
          JSON.stringify({
            ok: true,
            already_redeemed: true,
            redeemed_at: again.redeemed_at,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.error(upErr);
      return new Response(JSON.stringify({ error: "Could not complete redemption. Try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: dealRow } = await supabase.from("deals").select("title").eq("id", claim.deal_id).maybeSingle();

    return new Response(
      JSON.stringify({
        ok: true,
        already_redeemed: false,
        redeemed_at: nowIso,
        deal_title: dealRow?.title ?? null,
        deal_id: claim.deal_id,
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
