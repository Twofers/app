import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPastRedeemDeadline, VISUAL_REDEEM_AUTO_FINALIZE_MS } from "../_shared/claim-redeem.ts";

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

    const nowMs = Date.now();
    const { data: openClaims, error: openErr } = await supabase
      .from("deal_claims")
      .select("id, expires_at, grace_period_minutes, claim_status")
      .eq("user_id", user.id)
      .is("redeemed_at", null);

    let expiredCount = 0;
    if (!openErr && openClaims && openClaims.length > 0) {
      const toExpire = openClaims.filter((r: {
        id: string;
        expires_at: string;
        grace_period_minutes: number | null;
        claim_status: string | null;
      }) => {
        if (r.claim_status === "canceled" || r.claim_status === "redeemed") return false;
        const g = typeof r.grace_period_minutes === "number" ? r.grace_period_minutes : 10;
        return isPastRedeemDeadline(nowMs, r.expires_at, g);
      });
      if (toExpire.length > 0) {
        const ids = toExpire.map((r: { id: string }) => r.id);
        const { data: expUpd, error: expErr } = await supabase
          .from("deal_claims")
          .update({ claim_status: "expired", redeem_started_at: null })
          .in("id", ids)
          .is("redeemed_at", null)
          .select("id");
        if (expErr) {
          console.error(expErr);
        } else {
          expiredCount = (expUpd ?? []).length;
        }
      }
    } else if (openErr) {
      console.error(openErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        finalized_count: (updated ?? []).length,
        expired_count: expiredCount,
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
