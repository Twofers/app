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

const TRIAL_DAYS = 30;
const TRIAL_DISCLOSURE_VERSION = "twofer-business-card-trial-v1";
const DISPLAYED_PRICE = "$30/month per location";
const DISPLAYED_BILLING_INTERVAL = "monthly";
const DISPLAYED_TAX_LANGUAGE = "plus applicable taxes";

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function firstForwardedIp(req: Request): string | null {
  const raw = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip");
  const first = raw?.split(",")[0]?.trim();
  if (!first || first.length > 64) return null;
  return first;
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
    if (body.trial_acknowledged !== true) {
      return jsonResponse(req, { error: "Trial billing disclosure must be acknowledged." }, 400);
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

    const configuredPriceId = config.billingEnvironment === "production"
      ? config.twoferBusinessMonthlyPriceIdLive
      : config.twoferBusinessMonthlyPriceIdTest;
    const priceId = configuredPriceId ??
      safeGetString(Deno.env.get("STRIPE_TWOFER_BUSINESS_PRICE_ID")) ??
      safeGetString(Deno.env.get("STRIPE_PRICE_ID"));
    if (!priceId) {
      return jsonResponse(req, { error: "Billing price is not configured." }, 500);
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return jsonResponse(req, { error: "Stripe is not configured." }, 500);
    }
    if (stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment !== "production") {
      return jsonResponse(req, { error: "Live Stripe mode is not enabled for this environment." }, 500);
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    const { data: entitlement } = await supabaseAdmin
      .from("location_entitlements")
      .select("status")
      .eq("business_location_id", locationId)
      .maybeSingle();
    const status = safeGetString(entitlement?.status) ?? "trial_eligible";
    if (status !== "trial_eligible") {
      return jsonResponse(req, { error: "This location is not eligible for a new trial." }, 409);
    }

    const { data: trialHistory } = await supabaseAdmin
      .from("deal_credit_periods")
      .select("id")
      .eq("business_location_id", locationId)
      .in("source", ["trial", "admin_trial"])
      .limit(1);
    if ((trialHistory ?? []).length > 0) {
      return jsonResponse(req, { error: "This location has already used its trial." }, 409);
    }

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

    const baseSupabaseUrl = supabaseUrl.replace(/\/$/, "");
    const redirectBase = `${baseSupabaseUrl}/functions/v1/billing-checkout-redirect`;
    const successUrl = `${redirectBase}?checkout=success`;
    const cancelUrl = `${redirectBase}?checkout=cancel`;
    const appLocale = normalizeStripeCheckoutLocale(body.locale);
    const displayedTrialEndDate = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();

    const { data: intent, error: intentError } = await supabaseAdmin
      .from("trial_checkout_intents")
      .insert({
        owner_user_id: user.id,
        business_location_id: locationId,
        disclosure_version: TRIAL_DISCLOSURE_VERSION,
        locale: appLocale,
        displayed_price: DISPLAYED_PRICE,
        displayed_trial_end_date: displayedTrialEndDate,
        displayed_billing_interval: DISPLAYED_BILLING_INTERVAL,
        displayed_tax_language: DISPLAYED_TAX_LANGUAGE,
        purchase_surface: config.purchaseSurface,
        provider: "stripe",
        ip_address: firstForwardedIp(req),
        user_agent: req.headers.get("user-agent"),
        app_version: safeGetString(body.app_version),
      })
      .select("id")
      .single();
    if (intentError || !intent?.id) {
      return jsonResponse(req, { error: "Unable to record trial consent." }, 500);
    }

    const metadata = {
      business_location_id: locationId,
      billing_account_id: String(account.id),
      owner_user_id: user.id,
      environment: config.billingEnvironment,
      entitlement_version: config.entitlementVersion,
      purchase_surface: config.purchaseSurface,
      checkout_purpose: "trial_start",
      trial_checkout_intent_id: String(intent.id),
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
      payment_method_collection: "always",
      automatic_tax: { enabled: config.automaticTaxEnabled || Deno.env.get("STRIPE_TAX_ENABLED") === "true" },
      metadata,
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata,
      },
    });

    if (!session.url) {
      return jsonResponse(req, { error: "Stripe did not return a checkout session URL." }, 500);
    }

    await supabaseAdmin
      .from("trial_checkout_intents")
      .update({ checkout_session_id: session.id })
      .eq("id", intent.id);

    await supabaseAdmin
      .from("location_entitlements")
      .upsert(
        {
          business_location_id: locationId,
          billing_account_id: account.id,
          status: "trial_checkout_pending",
          entitlement_provider: "stripe",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_location_id" },
      );

    return jsonResponse(req, { checkout_url: session.url });
  } catch (err) {
    console.error("[stripe-create-checkout-session] error:", err);
    return jsonResponse(req, { error: "Failed to create checkout session." }, 500);
  }
});
