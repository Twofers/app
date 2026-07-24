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

function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return safeGetString((value as { id?: unknown }).id);
  }
  return null;
}

function unixSecondsToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
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
        { error: "Trial cancellation is not enabled.", error_code: "PURCHASE_SURFACE_DISABLED" },
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
      .select(
        "billing_account_id,status,trial_ends_at,current_period_ends_at,cancel_at_period_end,provider_subscription_id,billing_accounts(provider_customer_id)",
      )
      .eq("business_location_id", locationId)
      .maybeSingle();
    if (entitlementError) throw entitlementError;

    const status = safeGetString(entitlement?.status);
    if (status === "trial_canceling" && entitlement?.cancel_at_period_end === true) {
      return jsonResponse(req, {
        status: "trial_canceling",
        trial_ends_at: entitlement.trial_ends_at ?? entitlement.current_period_ends_at ?? null,
      });
    }
    if (status !== "trial_active") {
      return jsonResponse(req, { error: "This location does not have an active trial to cancel." }, 409);
    }

    const billingAccountId = safeGetString(entitlement?.billing_account_id);
    const subscriptionId = safeGetString(entitlement?.provider_subscription_id);
    const stripeCustomerId = safeGetString((entitlement as any)?.billing_accounts?.provider_customer_id);
    if (!billingAccountId || !subscriptionId || !stripeCustomerId) {
      return jsonResponse(req, { error: "Missing Stripe subscription details for this trial." }, 400);
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return jsonResponse(req, { error: "Stripe is not configured." }, 500);
    }
    if (stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment !== "production") {
      return jsonResponse(req, { error: "Live Stripe mode is not enabled for this environment." }, 500);
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    const subscription = await stripe.subscriptions.retrieve(subscriptionId) as any;
    if (subscription?.deleted === true || subscription?.status !== "trialing") {
      return jsonResponse(req, { error: "Stripe subscription is no longer trialing." }, 409);
    }
    if (stripeId(subscription.customer) !== stripeCustomerId) {
      return jsonResponse(req, { error: "Stripe customer does not match this location." }, 409);
    }
    const metadata = subscription.metadata ?? {};
    if (
      safeGetString(metadata.business_location_id) !== locationId ||
      safeGetString(metadata.billing_account_id) !== billingAccountId
    ) {
      return jsonResponse(req, { error: "Stripe subscription metadata does not match this location." }, 409);
    }

    const updated = subscription.cancel_at_period_end === true
      ? subscription
      : await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }) as any;
    const trialEndsAt = unixSecondsToIso(updated.trial_end) ?? entitlement?.trial_ends_at ?? null;
    const periodEndsAt = unixSecondsToIso(updated.current_period_end) ?? entitlement?.current_period_ends_at ?? trialEndsAt;

    await supabaseAdmin
      .from("location_entitlements")
      .update({
        status: "trial_canceling",
        cancel_at_period_end: true,
        trial_ends_at: trialEndsAt,
        current_period_ends_at: periodEndsAt,
        updated_at: new Date().toISOString(),
      })
      .eq("business_location_id", locationId);

    return jsonResponse(req, {
      status: "trial_canceling",
      trial_ends_at: trialEndsAt,
    });
  } catch (err) {
    console.error("[stripe-cancel-trial-subscription] error:", err);
    return jsonResponse(req, { error: "Failed to cancel trial." }, 500);
  }
});
