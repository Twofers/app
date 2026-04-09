import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import type { PostgrestError } from "https://esm.sh/@supabase/supabase-js@2";
import { loadSubscriptionPricingFromAppConfig } from "../_shared/subscription-pricing.ts";
import { selectMonthlyTierPriceId } from "../_shared/stripe-price-selection.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

type Tier = "pro" | "premium";

function safeGetString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

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
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestedTier = body?.tier;
    const tier: Tier | null = requestedTier === "premium" ? "premium" : requestedTier === "pro" ? "pro" : null;
    if (!tier) {
      return new Response(JSON.stringify({ error: "Missing/invalid tier." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pricing -> select Stripe price by matching unit_amount to app_config dollars.
    const pricing = await loadSubscriptionPricingFromAppConfig(supabaseAdmin);
    const targetMonthlyPrice = tier === "premium" ? pricing.premiumMonthlyPrice : pricing.proMonthlyPrice;
    const targetCents = Math.round(targetMonthlyPrice * 100);

    const prices = await stripe.prices.list({ active: true, limit: 100 });
    const matchingPriceId = selectMonthlyTierPriceId({
      tier,
      targetCents,
      prices: prices.data,
    });
    if (!matchingPriceId) {
      return new Response(
        JSON.stringify({
          error: `No unambiguous Stripe price found for tier=${tier} amountCents=${targetCents}. Configure lookup_key=twofer_${tier}_monthly or keep a single matching monthly price.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Find/create business_profiles row for this user and ensure we have a Stripe customer id.
    const selectBillingRow = async (col: "user_id" | "owner_id") => {
      return await supabaseUser
        .from("business_profiles")
        .select("id, stripe_customer_id")
        .eq(col, user.id)
        .maybeSingle();
    };

    const { data: bpByUser, error: bpUserErr } = await selectBillingRow("user_id");
    let bp = bpByUser;
    if (!bp && bpUserErr) {
      if ((bpUserErr as PostgrestError).code !== "PGRST116") {
        throw bpUserErr;
      }
    }
    if (!bp) {
      const { data: bpByOwner } = await selectBillingRow("owner_id");
      bp = bpByOwner;
    }
    if (!bp?.id) {
      return new Response(
        JSON.stringify({ error: "No business profile found. Complete business setup first." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let stripeCustomerId = safeGetString((bp as any).stripe_customer_id);

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { business_profile_id: bp.id },
      });
      stripeCustomerId = customer.id;

      await supabaseUser
        .from("business_profiles")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", bp.id);
    }

    // Redirect handling: Stripe success/cancel -> hosted redirect -> app deep link.
    const baseSupabaseUrl = supabaseUrl.replace(/\/$/, "");
    const redirectBase = `${baseSupabaseUrl}/functions/v1/billing-checkout-redirect`;
    const successUrl = `${redirectBase}?checkout=success`;
    const cancelUrl = `${redirectBase}?checkout=cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: matchingPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        business_profile_id: bp.id,
        subscription_tier: tier,
      },
      subscription_data: {
        metadata: {
          business_profile_id: bp.id,
          subscription_tier: tier,
        },
      },
    });

    if (!session.url) {
      return new Response(
        JSON.stringify({ error: "Stripe did not return a checkout session URL." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ checkout_url: session.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[stripe-create-checkout-session] error:", err);
    return new Response(JSON.stringify({ error: "Failed to create checkout session." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

