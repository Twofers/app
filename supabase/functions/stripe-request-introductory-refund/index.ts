import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  isUuid,
  loadRuntimeBillingConfig,
  safeGetString,
} from "../_shared/billing-runtime.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  decideIntroductoryRefund,
  nonNegativeInteger,
} from "../_shared/introductory-refund.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadPaidCreditsUsed(supabase: any, locationId: string): Promise<number> {
  const { data, error } = await supabase
    .from("deal_credit_periods")
    .select("credits_used")
    .eq("business_location_id", locationId)
    .eq("source", "paid_subscription");
  if (error) throw error;
  return (data ?? []).reduce((sum: number, row: { credits_used?: unknown }) => {
    return sum + nonNegativeInteger(row.credits_used);
  }, 0);
}

async function loadRefundUsageGuard(supabase: any): Promise<number | null> {
  const { data } = await supabase
    .from("app_runtime_config")
    .select("refund_max_paid_credits_used")
    .eq("id", 1)
    .maybeSingle();
  const value = data?.refund_max_paid_credits_used;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

function invoiceSubscriptionId(invoice: any): string | null {
  const subscription = invoice?.subscription;
  return typeof subscription === "string" ? subscription : safeGetString(subscription?.id);
}

function invoicePaymentIntentId(invoice: any): string | null {
  const paymentIntent = invoice?.payment_intent;
  return typeof paymentIntent === "string" ? paymentIntent : safeGetString(paymentIntent?.id);
}

async function resolveRefundPaymentReference(
  stripe: Stripe,
  invoice: any,
): Promise<{ chargeId: string | null; paymentIntentId: string | null }> {
  const chargeId = typeof invoice?.charge === "string"
    ? invoice.charge
    : safeGetString(invoice?.charge?.id);
  if (chargeId) return { chargeId, paymentIntentId: invoicePaymentIntentId(invoice) };

  const paymentIntentId = invoicePaymentIntentId(invoice);
  if (!paymentIntentId) return { chargeId: null, paymentIntentId: null };

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const latestCharge = typeof paymentIntent.latest_charge === "string"
    ? paymentIntent.latest_charge
    : safeGetString(paymentIntent.latest_charge?.id);
  return { chargeId: latestCharge, paymentIntentId };
}

async function insertRefundRequest(params: {
  supabase: any;
  locationId: string;
  ownerUserId: string;
  invoiceId: string;
  chargeId: string | null;
  paymentIntentId: string | null;
  creditsUsed: number;
}): Promise<string | null> {
  const { data, error } = await params.supabase
    .from("billing_refund_requests")
    .insert({
      business_location_id: params.locationId,
      owner_user_id: params.ownerUserId,
      first_paid_invoice_id: params.invoiceId,
      provider: "stripe",
      provider_charge_id: params.chargeId,
      provider_payment_intent_id: params.paymentIntentId,
      request_status: "pending",
      credits_used_at_request: params.creditsUsed,
    })
    .select("id")
    .single();

  if (error) {
    const detail = `${error.code ?? ""} ${error.message ?? ""}`;
    if (/23505|duplicate/i.test(detail)) return null;
    throw error;
  }

  return safeGetString(data?.id);
}

async function updateRefundRequest(
  supabase: any,
  id: string | null,
  values: Record<string, unknown>,
) {
  if (!id) return;
  const { error } = await supabase
    .from("billing_refund_requests")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) console.error("[stripe-request-introductory-refund] refund request update failed:", error);
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
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
        { error: "Refund requests are not enabled in the app.", error_code: "PURCHASE_SURFACE_DISABLED" },
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
        "billing_account_id,provider_subscription_id,first_paid_invoice_id,first_paid_at,introductory_refund_used_at,status,billing_accounts(provider_customer_id)",
      )
      .eq("business_location_id", locationId)
      .maybeSingle();
    if (entitlementError) throw entitlementError;

    const firstPaidInvoiceId = safeGetString(entitlement?.first_paid_invoice_id);
    const subscriptionId = safeGetString(entitlement?.provider_subscription_id);
    if (!firstPaidInvoiceId || !subscriptionId) {
      return jsonResponse(req, { error: "Introductory refund is not available for this location." }, 409);
    }

    const creditsUsed = await loadPaidCreditsUsed(supabaseAdmin, locationId);
    const refundMaxPaidCreditsUsed = await loadRefundUsageGuard(supabaseAdmin);
    const decision = decideIntroductoryRefund({
      firstPaidAt: safeGetString(entitlement?.first_paid_at),
      introductoryRefundUsedAt: safeGetString(entitlement?.introductory_refund_used_at),
      creditsUsed,
      refundMaxPaidCreditsUsed,
      nowMs: Date.now(),
    });
    if (!decision.eligible) {
      if (decision.reason === "usage_requires_support") {
        return jsonResponse(
          req,
          { error: "Refund request needs support review.", error_code: "REFUND_REQUIRES_SUPPORT" },
          409,
        );
      }
      return jsonResponse(
        req,
        { error: "Introductory refund is not available for this location.", error_code: decision.reason },
        409,
      );
    }

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return jsonResponse(req, { error: "Stripe is not configured." }, 500);
    }
    if (stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment !== "production") {
      return jsonResponse(req, { error: "Live Stripe mode is not enabled for this environment." }, 500);
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const invoice = await stripe.invoices.retrieve(firstPaidInvoiceId);
    if (
      invoice.amount_paid <= 0 ||
      safeGetString(invoice.currency)?.toLowerCase() !== "usd" ||
      invoiceSubscriptionId(invoice) !== subscriptionId
    ) {
      return jsonResponse(req, { error: "Introductory refund is not available for this invoice." }, 409);
    }

    const { chargeId, paymentIntentId } = await resolveRefundPaymentReference(stripe, invoice);
    if (!chargeId && !paymentIntentId) {
      return jsonResponse(req, { error: "Unable to locate refundable Stripe payment." }, 409);
    }

    const requestId = await insertRefundRequest({
      supabase: supabaseAdmin,
      locationId,
      ownerUserId: user.id,
      invoiceId: firstPaidInvoiceId,
      chargeId,
      paymentIntentId,
      creditsUsed,
    });
    if (!requestId) {
      return jsonResponse(req, { error: "Refund request already exists.", error_code: "REFUND_ALREADY_REQUESTED" }, 409);
    }

    try {
      const refund = await stripe.refunds.create({
        ...(chargeId ? { charge: chargeId } : { payment_intent: paymentIntentId }),
        reason: "requested_by_customer",
        metadata: {
          business_location_id: locationId,
          owner_user_id: user.id,
          refund_purpose: "introductory_first_paid_invoice",
          first_paid_invoice_id: firstPaidInvoiceId,
        },
      } as any);

      await stripe.subscriptions.cancel(subscriptionId);

      const resolvedAt = new Date().toISOString();
      await updateRefundRequest(supabaseAdmin, requestId, {
        provider_refund_id: refund.id,
        request_status: "approved",
        reason_code: "approved",
        resolved_at: resolvedAt,
        metadata: {
          refund_purpose: "introductory_first_paid_invoice",
        },
      });

      await supabaseAdmin
        .from("deal_credit_periods")
        .update({ status: "canceled", updated_at: resolvedAt })
        .eq("business_location_id", locationId)
        .eq("source", "paid_subscription")
        .eq("status", "active");

      await supabaseAdmin
        .from("location_entitlements")
        .update({
          status: "refunded_suspended",
          suspended_at: resolvedAt,
          suspension_reason: "introductory_refund",
          introductory_refund_used_at: resolvedAt,
          current_period_ends_at: resolvedAt,
          cancel_at_period_end: false,
          updated_at: resolvedAt,
        })
        .eq("business_location_id", locationId);

      return jsonResponse(req, { ok: true, status: "submitted" });
    } catch (err) {
      await updateRefundRequest(supabaseAdmin, requestId, {
        request_status: "failed",
        reason_code: "stripe_refund_failed",
        resolved_at: new Date().toISOString(),
        metadata: { error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500) },
      });
      throw err;
    }
  } catch (err) {
    console.error("[stripe-request-introductory-refund] error:", err);
    return jsonResponse(req, { error: "Failed to request introductory refund." }, 500);
  }
});
