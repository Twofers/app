import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey,
      {
        global: {
          headers: {
            Authorization: req.headers.get("Authorization")!,
          },
        },
      }
    );

    // 🔐 Get authenticated business user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in as a business owner." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔍 Verify user owns a business
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (businessError || !business) {
      return new Response(
        JSON.stringify({ error: "You must be a business owner to redeem tokens." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🚦 Rate limit: max 10 redeem attempts per minute per business owner
    const { data: dealIdsData } = await supabase
      .from("deals")
      .select("id")
      .eq("business_id", business.id);
    const dealIds = (dealIdsData ?? []).map((d) => d.id);
    if (dealIds.length > 0) {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { count: recentRedeems } = await supabase
        .from("deal_claims")
        .select("*", { count: "exact", head: true })
        .in("deal_id", dealIds)
        .gte("redeemed_at", oneMinuteAgo);
      if (recentRedeems !== null && recentRedeems >= 10) {
        return new Response(
          JSON.stringify({ error: "Too many attempts. Try again in 30 seconds." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // 📦 Parse request body
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const token = body.token;

    if (!token || typeof token !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid token" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔍 Fetch claim with deal and business info
    const { data: claim, error: claimError } = await supabase
      .from("deal_claims")
      .select(`
        *,
        deal:deals!inner(
          id,
          business_id,
          title,
          business:businesses!inner(id, owner_id)
        )
      `)
      .eq("token", token)
      .single();

    if (claimError || !claim) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔒 Verify token belongs to a deal owned by this business
    const deal = claim.deal as any;
    if (!deal || deal.business?.owner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "This token does not belong to your business" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ✅ Check if already redeemed
    if (claim.redeemed_at) {
      return new Response(
        JSON.stringify({ error: "This token has already been redeemed" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ⏰ Check if expired
    const now = new Date();
    const expiresAt = new Date(claim.expires_at);
    if (expiresAt < now) {
      return new Response(
        JSON.stringify({ error: "This token has expired" }),
        {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 💾 Mark as redeemed (guard against double-redeem)
    const { data: updated, error: updateError } = await supabase
      .from("deal_claims")
      .update({ redeemed_at: now.toISOString() })
      .eq("token", token)
      .is("redeemed_at", null)
      .select("redeemed_at")
      .single();

    if (updateError || !updated) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: updateError ? `Failed to redeem token: ${updateError.message}` : "This token has already been redeemed" }),
        {
          status: updateError ? 500 : 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ✅ Success
    return new Response(
      JSON.stringify({
        ok: true,
        deal_title: deal.title,
        redeemed_at: now.toISOString(),
        deal_id: deal.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({
        error: "Server error",
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
