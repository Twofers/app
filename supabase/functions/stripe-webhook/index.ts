import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadRuntimeBillingConfig, safeGetString } from "../_shared/billing-runtime.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

type Metadata = Record<string, string>;

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function unixSecondsToIso(ts: number | null | undefined): string | null {
  if (!ts || !Number.isFinite(ts)) return null;
  return new Date(ts * 1000).toISOString();
}

function metadataFrom(value: unknown): Metadata {
  const metadata = (value as { metadata?: unknown } | null)?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const out: Metadata = {};
  for (const [key, val] of Object.entries(metadata)) {
    if (typeof val === "string") out[key] = val;
  }
  return out;
}

function eventEnvironment(event: Stripe.Event, metadata: Metadata): string {
  return safeGetString(metadata.environment) ?? (event.livemode ? "production" : "development");
}

function enforceLivemode(event: Stripe.Event): boolean {
  const expected = Deno.env.get("STRIPE_EXPECTED_LIVEMODE");
  if (expected !== "true" && expected !== "false") return true;
  return event.livemode === (expected === "true");
}

async function fetchSubscriptionForEvent(stripe: Stripe, eventType: string, obj: any): Promise<any | null> {
  if (eventType.startsWith("customer.subscription.")) return obj;
  const rawSubscription = obj?.subscription;
  const subscriptionId = typeof rawSubscription === "string" ? rawSubscription : rawSubscription?.id;
  if (!subscriptionId) return null;
  return await stripe.subscriptions.retrieve(subscriptionId);
}

async function insertProviderEvent(supabase: any, event: Stripe.Event, environment: string) {
  const { data, error } = await supabase
    .from("billing_provider_events")
    .insert({
      provider: "stripe",
      provider_event_id: event.id,
      environment,
      event_type: event.type,
      processing_status: "processing",
      payload: event,
    })
    .select("id")
    .single();

  if (error) {
    const detail = `${error.code ?? ""} ${error.message ?? ""}`;
    if (/23505|duplicate/i.test(detail)) return { duplicate: true, id: null };
    throw error;
  }
  return { duplicate: false, id: data?.id ?? null };
}

async function markProviderEvent(supabase: any, id: string | null, status: "processed" | "failed", errorMessage?: string) {
  if (!id) return;
  await supabase
    .from("billing_provider_events")
    .update({
      processing_status: status,
      processed_at: new Date().toISOString(),
      error_message: errorMessage ? errorMessage.slice(0, 800) : null,
    })
    .eq("id", id);
}

async function grantPaidPeriod(params: {
  supabase: any;
  locationId: string;
  billingAccountId: string;
  subscription: any;
  invoice: any;
}) {
  const { supabase, locationId, billingAccountId, subscription, invoice } = params;
  const config = await loadRuntimeBillingConfig(supabase);
  const startedAt =
    unixSecondsToIso(subscription?.current_period_start) ??
    unixSecondsToIso(invoice?.period_start) ??
    new Date().toISOString();
  const endsAt =
    unixSecondsToIso(subscription?.current_period_end) ??
    unixSecondsToIso(invoice?.period_end) ??
    new Date(Date.now() + 30 * 86400000).toISOString();
  const invoiceId = safeGetString(invoice?.id) ?? safeGetString(invoice?.latest_invoice) ?? crypto.randomUUID();
  const subscriptionId = safeGetString(subscription?.id);
  const priceId = safeGetString(subscription?.items?.data?.[0]?.price?.id);

  await supabase
    .from("location_entitlements")
    .upsert(
      {
        business_location_id: locationId,
        billing_account_id: billingAccountId,
        status: "paid_active",
        entitlement_provider: "stripe",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_location_id" },
    );

  await supabase
    .from("deal_credit_periods")
    .update({ status: "replaced", updated_at: new Date().toISOString() })
    .eq("business_location_id", locationId)
    .eq("status", "active");

  const { data: period, error: periodError } = await supabase
    .from("deal_credit_periods")
    .insert({
      business_location_id: locationId,
      source: "paid_subscription",
      status: "active",
      starts_at: startedAt,
      ends_at: endsAt,
      credits_granted: config.paidDealCreditAllowance,
      configuration_snapshot: {
        paid_deal_credit_allowance: config.paidDealCreditAllowance,
        credit_reservation_ttl_minutes: config.creditReservationTtlMinutes,
        invoice_id: invoiceId,
        granted_at: new Date().toISOString(),
      },
      external_reference: `stripe_invoice:${invoiceId}`,
    })
    .select("id")
    .single();

  if (periodError) {
    const detail = `${periodError.code ?? ""} ${periodError.message ?? ""}`;
    if (!/23505|duplicate/i.test(detail)) throw periodError;
  }

  const creditPeriodId = period?.id;
  if (creditPeriodId) {
    const { error: ledgerError } = await supabase
      .from("deal_credit_ledger")
      .insert({
        business_location_id: locationId,
        credit_period_id: creditPeriodId,
        event_type: "grant",
        purpose: "admin_adjustment",
        amount: config.paidDealCreditAllowance,
        idempotency_key: `paid_grant:${invoiceId}`,
        metadata: { provider: "stripe", invoice_id: invoiceId },
      });
    if (ledgerError) {
      const detail = `${ledgerError.code ?? ""} ${ledgerError.message ?? ""}`;
      if (!/23505|duplicate/i.test(detail)) throw ledgerError;
    }
  }

  await supabase
    .from("location_entitlements")
    .update({
      billing_account_id: billingAccountId,
      status: "paid_active",
      entitlement_provider: "stripe",
      trial_ends_at: null,
      current_period_started_at: startedAt,
      current_period_ends_at: endsAt,
      cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
      suspended_at: null,
      suspension_reason: null,
      provider_subscription_id: subscriptionId,
      provider_price_id: priceId,
      first_paid_invoice_id: invoiceId,
      first_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("business_location_id", locationId)
    .is("first_paid_invoice_id", null);

  await supabase
    .from("location_entitlements")
    .update({
      billing_account_id: billingAccountId,
      status: "paid_active",
      entitlement_provider: "stripe",
      trial_ends_at: null,
      current_period_started_at: startedAt,
      current_period_ends_at: endsAt,
      cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
      suspended_at: null,
      suspension_reason: null,
      provider_subscription_id: subscriptionId,
      provider_price_id: priceId,
      updated_at: new Date().toISOString(),
    })
    .eq("business_location_id", locationId);
}

async function syncSubscriptionState(params: {
  supabase: any;
  locationId: string;
  billingAccountId: string;
  subscription: any;
}) {
  const { supabase, locationId, billingAccountId, subscription } = params;
  const status = String(subscription?.status ?? "");
  const subscriptionId = safeGetString(subscription?.id);
  const priceId = safeGetString(subscription?.items?.data?.[0]?.price?.id);
  const periodEndsAt = unixSecondsToIso(subscription?.current_period_end);
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
  const nextStatus =
    status === "canceled"
      ? "canceled_suspended"
      : cancelAtPeriodEnd
        ? "paid_canceling"
        : status === "past_due" || status === "unpaid"
          ? "payment_failed_suspended"
          : status === "active"
            ? "paid_active"
            : "checkout_pending";

  await supabase
    .from("location_entitlements")
    .update({
      billing_account_id: billingAccountId,
      status: nextStatus,
      entitlement_provider: "stripe",
      current_period_ends_at: periodEndsAt,
      cancel_at_period_end: cancelAtPeriodEnd,
      suspended_at: nextStatus.endsWith("_suspended") ? new Date().toISOString() : null,
      suspension_reason: nextStatus.endsWith("_suspended") ? nextStatus : null,
      provider_subscription_id: subscriptionId,
      provider_price_id: priceId,
      updated_at: new Date().toISOString(),
    })
    .eq("business_location_id", locationId);
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
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
  const stripeWebhookSecret =
    Deno.env.get("STRIPE_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET");
  if (!stripeWebhookSecret) {
    return jsonResponse(req, { error: "Missing Stripe webhook signing secret." }, 500);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
  const webhookSignature = req.headers.get("stripe-signature") ?? "";
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    const cryptoProvider = Stripe.createSubtleCryptoProvider();
    event = await stripe.webhooks.constructEventAsync(
      payload,
      webhookSignature,
      stripeWebhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch {
    return jsonResponse(req, { error: "Invalid Stripe webhook signature." }, 400);
  }

  if (!enforceLivemode(event)) {
    return jsonResponse(req, { error: "Stripe event mode is not accepted for this environment." }, 400);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const obj: any = event.data.object;
  const subscription = await fetchSubscriptionForEvent(stripe, event.type, obj);
  const mergedMetadata: Metadata = {
    ...metadataFrom(subscription),
    ...metadataFrom(obj),
  };
  const environment = eventEnvironment(event, mergedMetadata);
  const providerEvent = await insertProviderEvent(supabase, event, environment);
  if (providerEvent.duplicate) {
    return jsonResponse(req, { received: true, duplicate: true });
  }

  try {
    const locationId = safeGetString(mergedMetadata.business_location_id);
    const billingAccountId = safeGetString(mergedMetadata.billing_account_id);
    if (!locationId || !billingAccountId) {
      await markProviderEvent(supabase, providerEvent.id, "processed");
      return jsonResponse(req, { received: true, skipped: true });
    }

    const customerId = safeGetString(obj?.customer) ?? safeGetString(subscription?.customer);
    if (customerId) {
      await supabase
        .from("billing_accounts")
        .update({
          provider: "stripe",
          provider_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", billingAccountId);
    }

    if (
      event.type === "checkout.session.completed"
    ) {
      await supabase
        .from("location_entitlements")
        .update({
          billing_account_id: billingAccountId,
          status: "checkout_pending",
          entitlement_provider: "stripe",
          provider_subscription_id: safeGetString(obj?.subscription),
          updated_at: new Date().toISOString(),
        })
        .eq("business_location_id", locationId);
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
      await grantPaidPeriod({ supabase, locationId, billingAccountId, subscription, invoice: obj });
    } else if (event.type === "invoice.payment_failed") {
      await supabase
        .from("location_entitlements")
        .update({
          billing_account_id: billingAccountId,
          status: "payment_failed_suspended",
          entitlement_provider: "stripe",
          suspended_at: new Date().toISOString(),
          suspension_reason: "payment_failed",
          provider_subscription_id: safeGetString(subscription?.id),
          updated_at: new Date().toISOString(),
        })
        .eq("business_location_id", locationId);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncSubscriptionState({ supabase, locationId, billingAccountId, subscription });
    } else if (event.type === "charge.refunded" || event.type === "refund.created") {
      await supabase
        .from("location_entitlements")
        .update({
          status: "refunded_suspended",
          suspended_at: new Date().toISOString(),
          suspension_reason: "refunded",
          updated_at: new Date().toISOString(),
        })
        .eq("business_location_id", locationId);
    }

    await markProviderEvent(supabase, providerEvent.id, "processed");
    return jsonResponse(req, { received: true });
  } catch (err) {
    await markProviderEvent(
      supabase,
      providerEvent.id,
      "failed",
      err instanceof Error ? err.message : String(err),
    );
    console.error("[stripe-webhook] error:", err);
    return jsonResponse(req, { error: "Webhook handler failed" }, 500);
  }
});
