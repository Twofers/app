import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  isUuid,
  loadRuntimeBillingConfig,
  safeGetString,
} from "../_shared/billing-runtime.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

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
    const supabaseServiceKey = getServiceRoleKey();
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
      return jsonResponse(req, { error: "Unauthorized." }, 401);
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
        { error: "Checkout reset is not enabled.", error_code: "PURCHASE_SURFACE_DISABLED" },
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

    const { data: entitlement, error: entitlementError } = await supabaseAdmin
      .from("location_entitlements")
      .select("status,provider_subscription_id")
      .eq("business_location_id", locationId)
      .maybeSingle();
    if (entitlementError) throw entitlementError;

    if (safeGetString(entitlement?.status) !== "trial_checkout_pending") {
      return jsonResponse(req, { status: safeGetString(entitlement?.status) ?? "not_pending" });
    }
    if (safeGetString(entitlement?.provider_subscription_id)) {
      return jsonResponse(req, { error: "Checkout already created a subscription." }, 409);
    }

    const { data: trialHistory, error: trialHistoryError } = await supabaseAdmin
      .from("deal_credit_periods")
      .select("id")
      .eq("business_location_id", locationId)
      .in("source", ["trial", "admin_trial"])
      .limit(1);
    if (trialHistoryError) throw trialHistoryError;
    if ((trialHistory ?? []).length > 0) {
      return jsonResponse(req, { error: "This location has already started a trial." }, 409);
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return jsonResponse(req, { error: "Stripe is not configured." }, 500);
    }
    if (stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment !== "production") {
      return jsonResponse(req, { error: "Live Stripe mode is not enabled for this environment." }, 500);
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    const { data: intent, error: intentError } = await supabaseAdmin
      .from("trial_checkout_intents")
      .select("checkout_session_id")
      .eq("business_location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (intentError) throw intentError;

    const checkoutSessionId = safeGetString(intent?.checkout_session_id);
    if (checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId) as any;
      const sessionStatus = safeGetString(session?.status);
      if (sessionStatus === "complete") {
        return jsonResponse(req, { error: "Checkout completed and is waiting for webhook confirmation." }, 409);
      }
      if (sessionStatus === "open") {
        await stripe.checkout.sessions.expire(checkoutSessionId);
      }
    }

    await supabaseAdmin
      .from("location_entitlements")
      .update({
        status: "trial_eligible",
        entitlement_provider: null,
        provider_subscription_id: null,
        provider_price_id: null,
        trial_started_at: null,
        trial_ends_at: null,
        current_period_started_at: null,
        current_period_ends_at: null,
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      })
      .eq("business_location_id", locationId)
      .eq("status", "trial_checkout_pending")
      .is("provider_subscription_id", null);

    return jsonResponse(req, { status: "trial_eligible" });
  } catch (err) {
    console.error("[stripe-expire-pending-checkout] error:", err);
    return jsonResponse(req, { error: "Failed to reset pending checkout." }, 500);
  }
});
