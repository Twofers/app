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
        { error: "Billing portal is not enabled.", error_code: "PURCHASE_SURFACE_DISABLED" },
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
      .select("billing_account_id,billing_accounts(provider_customer_id)")
      .eq("business_location_id", locationId)
      .maybeSingle();
    if (entitlementError) throw entitlementError;

    const stripeCustomerId = safeGetString(
      (entitlement as any)?.billing_accounts?.provider_customer_id,
    );
    if (!stripeCustomerId) {
      return jsonResponse(req, { error: "Missing Stripe customer id for this location." }, 400);
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return jsonResponse(req, { error: "Stripe is not configured." }, 500);
    }
    if (stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment !== "production") {
      return jsonResponse(req, { error: "Live Stripe mode is not enabled for this environment." }, 500);
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    const baseSupabaseUrl = supabaseUrl.replace(/\/$/, "");
    const returnUrl = `${baseSupabaseUrl}/functions/v1/billing-checkout-redirect`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return jsonResponse(req, { url: portalSession.url });
  } catch (err) {
    console.error("[stripe-customer-portal-session] error:", err);
    return jsonResponse(req, { error: "Failed to create portal session." }, 500);
  }
});
