import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  finalizeStaleVisualRedeemForClaim,
  isPastRedeemDeadline,
} from "../_shared/claim-redeem.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";

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
    /** Service role — deal_claims writes must not depend on the client RLS grant. See findings/02-deal-claims-self-redeem.md. */
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: { claim_id?: string; location_id?: string };
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
    // Optional: the client doesn't send this today. If a future client version
    // does, reject a mismatch the same way redeem-token's WRONG_LOCATION_REDEMPTION
    // does. See findings/06-visual-redeem-honor-system.md (Option 1).
    const clientLocationId = typeof body.location_id === "string" ? body.location_id.trim() : "";

    const now = new Date();
    const nowIso = now.toISOString();

    await finalizeStaleVisualRedeemForClaim(supabaseAdmin, claimId, nowIso);

    const { data: claim, error: fetchErr } = await supabase
      .from("deal_claims")
      .select(
        "id, user_id, deal_id, business_id, location_id, expires_at, redeemed_at, claim_status, redeem_started_at, grace_period_minutes, deal:deals!inner(id,is_demo)",
      )
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

    if (clientLocationId && claim.location_id && clientLocationId !== claim.location_id) {
      return new Response(
        JSON.stringify({
          error: "This deal can only be redeemed at the location shown in your wallet.",
          error_code: "WRONG_LOCATION_REDEMPTION",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const deal = claim.deal as { is_demo?: boolean | null } | null;
    if (deal?.is_demo === true) {
      return new Response(JSON.stringify({ error: "This is sample content for testing only. Not a real offer." }), {
        status: 400,
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
      await supabaseAdmin
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
      await finalizeStaleVisualRedeemForClaim(supabaseAdmin, claimId, nowIso);
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

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("deal_claims")
      .update({
        redeemed_at: nowIso,
        claim_status: "redeemed",
        redeem_method: "visual",
        redeem_started_at: null,
        redeemed_at_location_id: claim.location_id ?? null,
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

    // Audit trail: give visual completions the same append-only record staff/
    // owner redemptions get, so every redemption method shares one trail.
    // claim_id is UNIQUE on redemptions, so a retry can't double-insert.
    if (claim.business_id) {
      const { error: auditErr } = await supabaseAdmin.from("redemptions").insert({
        claim_id: claimId,
        deal_id: claim.deal_id,
        business_id: claim.business_id,
        redemption_device_id: null,
        redeemer_user_id: null,
        device_label: "Customer visual redeem",
        redeemed_at: nowIso,
        redeem_method: "visual",
        code_type: "visual",
        location_id: claim.location_id ?? null,
      });
      if (auditErr && auditErr.code !== "23505") {
        console.error("[complete-visual-redeem] redemptions audit insert failed:", auditErr);
      }
    }

    const { data: dealRow } = await supabase
      .from("deals")
      .select("title, source_locale, title_en, title_es, title_ko")
      .eq("id", claim.deal_id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        ok: true,
        already_redeemed: false,
        redeemed_at: nowIso,
        deal_title: dealRow?.title ?? null,
        deal_source_locale: dealRow?.source_locale ?? null,
        deal_title_en: dealRow?.title_en ?? null,
        deal_title_es: dealRow?.title_es ?? null,
        deal_title_ko: dealRow?.title_ko ?? null,
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
