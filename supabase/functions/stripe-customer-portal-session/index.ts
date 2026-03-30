import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
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

    // Find/create business_profiles stripe_customer_id.
    const { data: bpByUser, error: bpUserErr } = await supabase
      .from("business_profiles")
      .select("id, stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let bp = bpByUser;
    if (!bp && bpUserErr) {
      if (bpUserErr.code !== "PGRST116") throw bpUserErr;
    }

    if (!bp) {
      const { data: bpByOwner } = await supabase
        .from("business_profiles")
        .select("id, stripe_customer_id")
        .eq("owner_id", user.id)
        .maybeSingle();
      bp = bpByOwner ?? null;
    }

    const stripeCustomerId = bp?.stripe_customer_id;
    if (!stripeCustomerId) {
      return new Response(JSON.stringify({ error: "Missing Stripe customer id for this business." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseSupabaseUrl = supabaseUrl.replace(/\/$/, "");
    const returnUrl = `${baseSupabaseUrl}/functions/v1/billing-checkout-redirect`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return new Response(JSON.stringify({ url: portalSession.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[stripe-customer-portal-session] error:", err);
    return new Response(JSON.stringify({ error: "Failed to create portal session." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

