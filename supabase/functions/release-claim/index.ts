import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";

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
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
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

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claimId = typeof body.claim_id === "string" ? body.claim_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claimId)) {
      return new Response(JSON.stringify({ error: "Missing or invalid claim_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: claim, error: claimError } = await supabase
      .from("deal_claims")
      .select("id, user_id, deal_id, claim_status, redeemed_at, expires_at")
      .eq("id", claimId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (claimError || !claim) {
      return new Response(JSON.stringify({ error: "Claim not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (claim.redeemed_at || claim.claim_status === "redeemed") {
      return new Response(JSON.stringify({ error: "Redeemed claims cannot be released." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (claim.claim_status !== "active" && claim.claim_status !== "redeeming") {
      return new Response(JSON.stringify({ error: "This claim cannot be released." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    const expiresAt = Date.parse(String(claim.expires_at ?? ""));
    if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
      await supabaseAdmin
        .from("deal_claims")
        .update({ claim_status: "expired", redeem_started_at: null })
        .eq("id", claimId)
        .eq("user_id", user.id)
        .is("redeemed_at", null);
      return new Response(JSON.stringify({ error: "This claim has already expired." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: released, error: releaseError } = await supabaseAdmin
      .from("deal_claims")
      .update({
        claim_status: "released",
        released_at: now.toISOString(),
        redeem_started_at: null,
      })
      .eq("id", claimId)
      .eq("user_id", user.id)
      .is("redeemed_at", null)
      .in("claim_status", ["active", "redeeming"])
      .select("id, claim_status, released_at")
      .maybeSingle();

    if (releaseError || !released) {
      console.error("[release-claim] update failed", releaseError);
      return new Response(JSON.stringify({ error: "Could not release this deal. Try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        status: "RELEASED",
        claim_id: claimId,
        released_at: released.released_at,
        message: "This deal has been released from your wallet. You can now claim another deal.",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[release-claim] unexpected error", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
