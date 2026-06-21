import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  isUuid,
  loadRuntimeBillingConfig,
  normalizeStripeCheckoutLocale,
  safeGetString,
} from "../_shared/billing-runtime.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return jsonResponse(req, { error: "Unauthorized. Please log in." }, 401);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { error: "Invalid JSON body" }, 400);
    }

    const locationId = safeGetString(body.location_id);
    if (!locationId || !isUuid(locationId)) {
      return jsonResponse(req, { error: "Missing or invalid location_id." }, 400);
    }

    const config = await loadRuntimeBillingConfig(supabaseAdmin as any);
    if (config.purchaseSurface !== "in_app_link") {
      return jsonResponse(
        req,
        { error: "Purchases are not enabled.", error_code: "PURCHASE_SURFACE_DISABLED" },
        403,
      );
    }

    const { data: ownsLocation, error: ownsError } = await supabaseAdmin.rpc("user_owns_business_location", {
      p_business_location_id: locationId,
      p_user_id: user.id,
    });
    if (ownsError || ownsLocation !== true) {
      return jsonResponse(req, { error: "Location not found for owner." }, 403);
    }

    const priceId = safeGetString(Deno.env.get("STRIPE_TWOFER_BUSINESS_PRICE_ID")) ??
      safeGetString(Deno.env.get("STRIPE_PRICE_ID"));
    if (!priceId) {
      return jsonResponse(req, { error: "Billing price is not configured." }, 500);
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return jsonResponse(req, { error: "Stripe is not configured." }, 500);
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    const { data: account, error: accountError } = await supabaseAdmin
      .from("billing_accounts")
      .upsert(
        {
          owner_user_id: user.id,
          provider: "stripe",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_user_id" },
      )
      .select("id,provider_customer_id")
      .single();
    if (accountError || !account?.id) {
      return jsonResponse(req, { error: "Unable to prepare billing account." }, 500);
    }

    let stripeCustomerId = safeGetString(account.provider_customer_id);
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          owner_user_id: user.id,
          billing_account_id: account.id,
        },
      });
      stripeCustomerId = customer.id;
      await supabaseAdmin
        .from("billing_accounts")
        .update({
          provider: "stripe",
          provider_customer_id: stripeCustomerId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);
    }

    await supabaseAdmin
      .from("location_entitlements")
      .upsert(
        {
          business_location_id: locationId,
          billing_account_id: account.id,
          status: "checkout_pending",
          entitlement_provider: "stripe",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_location_id" },
      );

    const baseSupabaseUrl = supabaseUrl.replace(/\/$/, "");
    const redirectBase = `${baseSupabaseUrl}/functions/v1/billing-checkout-redirect`;
    const successUrl = `${redirectBase}?checkout=success`;
    const cancelUrl = `${redirectBase}?checkout=cancel`;
    const appLocale = normalizeStripeCheckoutLocale(body.locale);
    const environment = safeGetString(Deno.env.get("TWOFER_BILLING_ENVIRONMENT")) ?? "development";
    const metadata = {
      business_location_id: locationId,
      billing_account_id: String(account.id),
      owner_user_id: user.id,
      app_locale: appLocale,
      environment,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: locationId,
      locale: appLocale,
      allow_promotion_codes: false,
      automatic_tax: { enabled: Deno.env.get("STRIPE_TAX_ENABLED") === "true" },
      metadata,
      subscription_data: { metadata },
    });

    if (!session.url) {
      return jsonResponse(req, { error: "Stripe did not return a checkout session URL." }, 500);
    }

    return jsonResponse(req, { checkout_url: session.url });
  } catch (err) {
    console.error("[stripe-create-checkout-session] error:", err);
    return jsonResponse(req, { error: "Failed to create checkout session." }, 500);
  }
});
