import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadRuntimeBillingConfig, safeGetString, type RuntimeBillingConfig } from "../_shared/billing-runtime.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  applyBusinessBillingAccessState,
  ensurePrimaryBusinessLocationId,
} from "../_shared/business-location-entitlement-sync.ts";
import { getBusinessCapabilities } from "../_shared/business-capabilities.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

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

function stripeReferenceId(value: unknown): string | null {
  if (typeof value === "string") return safeGetString(value);
  return safeGetString((value as { id?: unknown } | null)?.id);
}

function latestRefundFromCharge(charge: any): any | null {
  const refunds = Array.isArray(charge?.refunds?.data) ? charge.refunds.data : [];
  if (!refunds.length) return null;
  return refunds.find((refund: any) => safeGetString(metadataFrom(refund).refund_purpose)) ?? refunds[0];
}

function refundMetadataFromCharge(charge: any): Metadata {
  return metadataFrom(latestRefundFromCharge(charge));
}

function eventEnvironment(event: Stripe.Event, metadata: Metadata): string {
  return safeGetString(metadata.environment) ?? (event.livemode ? "production" : "test");
}

function enforceLivemode(event: Stripe.Event): boolean {
  const expected = Deno.env.get("STRIPE_EXPECTED_LIVEMODE");
  if (expected !== "true" && expected !== "false") return true;
  return event.livemode === (expected === "true");
}

function firstSubscriptionPriceId(subscription: any): string | null {
  return safeGetString(subscription?.items?.data?.[0]?.price?.id);
}

function expectedPriceId(config: RuntimeBillingConfig): string | null {
  return config.billingEnvironment === "production"
    ? config.twoferBusinessMonthlyPriceIdLive
    : config.twoferBusinessMonthlyPriceIdTest;
}

function assertExpectedPrice(config: RuntimeBillingConfig, subscription: any) {
  const expected = expectedPriceId(config);
  if (!expected) return;
  const actual = firstSubscriptionPriceId(subscription);
  if (actual !== expected) {
    throw new Error("Unexpected Stripe price for Twofer Business subscription.");
  }
}

function isRealPaidSubscriptionCycleInvoice(invoice: any): boolean {
  const amountPaid = typeof invoice?.amount_paid === "number" ? invoice.amount_paid : 0;
  const billingReason = safeGetString(invoice?.billing_reason);
  const currency = safeGetString(invoice?.currency)?.toLowerCase();
  return amountPaid > 0 && billingReason === "subscription_cycle" && currency === "usd";
}

function isTrialStartCheckout(metadata: Metadata): boolean {
  return safeGetString(metadata.checkout_purpose) === "trial_start";
}

function shouldDeferTrialSubscriptionSync(existingStatus: string | null, stripeStatus: string): boolean {
  const awaitingVerifiedActivation =
    existingStatus === null ||
    existingStatus === "trial_eligible" ||
    existingStatus === "trial_checkout_pending" ||
    existingStatus === "pending" ||
    existingStatus === "approved_not_activated";
  return awaitingVerifiedActivation && (stripeStatus === "trialing" || stripeStatus === "active");
}

function isRefundWebhookEvent(eventType: string): boolean {
  return eventType === "charge.refunded" || eventType === "refund.created";
}

function compactRecord(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

function refundWebhookDetails(eventType: string, obj: any, metadata: Metadata) {
  const refund = eventType === "refund.created" ? obj : latestRefundFromCharge(obj);
  const charge = eventType === "charge.refunded" ? obj : null;
  return {
    refundId: stripeReferenceId(refund?.id),
    chargeId: stripeReferenceId(refund?.charge) ?? stripeReferenceId(charge?.id),
    paymentIntentId: stripeReferenceId(refund?.payment_intent) ?? stripeReferenceId(charge?.payment_intent),
    firstPaidInvoiceId: safeGetString(metadata.first_paid_invoice_id),
    amount: typeof refund?.amount === "number"
      ? refund.amount
      : typeof charge?.amount_refunded === "number"
        ? charge.amount_refunded
        : null,
    currency: safeGetString(refund?.currency) ?? safeGetString(charge?.currency),
    status: safeGetString(refund?.status) ?? (eventType === "charge.refunded" ? "succeeded" : null),
    reason: safeGetString(refund?.reason),
  };
}

async function findRefundRequest(supabase: any, details: ReturnType<typeof refundWebhookDetails>) {
  const filters = [
    ["provider_refund_id", details.refundId],
    ["provider_charge_id", details.chargeId],
    ["provider_payment_intent_id", details.paymentIntentId],
    ["first_paid_invoice_id", details.firstPaidInvoiceId],
  ] as const;

  for (const [column, value] of filters) {
    if (!value) continue;
    const { data, error } = await supabase
      .from("billing_refund_requests")
      .select("id,business_location_id,request_status")
      .eq(column, value)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
  }

  return null;
}

async function billingAccountForLocation(supabase: any, locationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("location_entitlements")
    .select("billing_account_id")
    .eq("business_location_id", locationId)
    .maybeSingle();
  if (error) throw error;
  return safeGetString(data?.billing_account_id);
}

async function recordRefundWebhookDetails(params: {
  supabase: any;
  eventType: string;
  providerEventId: string;
  obj: any;
  metadata: Metadata;
  locationId: string | null;
  billingAccountId: string | null;
}): Promise<{ locationId: string | null; billingAccountId: string | null; details: ReturnType<typeof refundWebhookDetails> }> {
  const { supabase, eventType, providerEventId, obj, metadata } = params;
  const details = refundWebhookDetails(eventType, obj, metadata);
  const refundRequest = await findRefundRequest(supabase, details);
  const locationId = params.locationId ?? safeGetString(refundRequest?.business_location_id);
  const billingAccountId = params.billingAccountId ?? (locationId ? await billingAccountForLocation(supabase, locationId) : null);

  if (refundRequest?.id) {
    const now = new Date().toISOString();
    const refundStatus = details.status ?? "recorded";
    const update: Record<string, unknown> = {
      request_status: refundStatus === "failed" ? "failed" : "approved",
      reason_code: refundStatus === "failed" ? "provider_refund_failed" : "provider_refund_recorded",
      resolved_at: now,
      updated_at: now,
      metadata: compactRecord({
        refund_purpose: safeGetString(metadata.refund_purpose),
        refund_event_type: eventType,
        provider_event_id: providerEventId,
        provider_refund_status: refundStatus,
        provider_refund_amount: details.amount,
        provider_refund_currency: details.currency,
        provider_refund_reason: details.reason,
        first_paid_invoice_id: details.firstPaidInvoiceId,
      }),
    };
    if (details.refundId) update.provider_refund_id = details.refundId;
    if (details.chargeId) update.provider_charge_id = details.chargeId;
    if (details.paymentIntentId) update.provider_payment_intent_id = details.paymentIntentId;

    const { error } = await supabase
      .from("billing_refund_requests")
      .update(update)
      .eq("id", refundRequest.id);
    if (error) throw error;
  }

  return { locationId, billingAccountId, details };
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
    if (/23505|duplicate/i.test(detail)) {
      const { data: existing, error: existingError } = await supabase
        .from("billing_provider_events")
        .select("id,processing_status")
        .eq("provider", "stripe")
        .eq("provider_event_id", event.id)
        .maybeSingle();

      if (existingError) throw existingError;

      const existingId = safeGetString(existing?.id);
      if (existingId && safeGetString(existing?.processing_status) === "failed") {
        const { data: retry, error: retryError } = await supabase
          .from("billing_provider_events")
          .update({
            environment,
            event_type: event.type,
            processing_status: "processing",
            payload: event,
            processed_at: null,
            error_message: null,
          })
          .eq("id", existingId)
          .eq("processing_status", "failed")
          .select("id")
          .maybeSingle();

        if (retryError) throw retryError;
        const retryId = safeGetString(retry?.id);
        if (retryId) return { duplicate: false, id: retryId };
      }

      return { duplicate: true, id: existingId };
    }
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
  const config = await loadRuntimeBillingConfig(supabase as any);
  assertExpectedPrice(config, subscription);
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
  if (!subscriptionId) throw new Error("Missing Stripe subscription for paid invoice.");
  if (!isRealPaidSubscriptionCycleInvoice(invoice)) return;
  if (safeGetString(subscription?.status) !== "active") return;
  const priceId = firstSubscriptionPriceId(subscription);
  const externalReference = `paid_subscription:${subscriptionId}:${startedAt}`;
  const { data: existingPeriod } = await supabase
    .from("deal_credit_periods")
    .select("id")
    .eq("external_reference", externalReference)
    .maybeSingle();

  await supabase
    .from("location_entitlements")
    .upsert(
      {
        business_location_id: locationId,
        billing_account_id: billingAccountId,
        status: "pro_active",
        entitlement_provider: "stripe",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_location_id" },
    );

  if (!existingPeriod?.id) {
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
          provider_subscription_id: subscriptionId,
          granted_at: new Date().toISOString(),
        },
        external_reference: externalReference,
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
          idempotency_key: externalReference,
          metadata: { provider: "stripe", invoice_id: invoiceId, subscription_id: subscriptionId },
        });
      if (ledgerError) {
        const detail = `${ledgerError.code ?? ""} ${ledgerError.message ?? ""}`;
        if (!/23505|duplicate/i.test(detail)) throw ledgerError;
      }
    }
  }

  await supabase
    .from("location_entitlements")
    .update({
      billing_account_id: billingAccountId,
      status: "pro_active",
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
      status: "pro_active",
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

async function activateTrialFromCheckout(params: {
  supabase: any;
  locationId: string;
  billingAccountId: string;
  ownerUserId: string;
  subscription: any;
  checkoutSession: any;
  metadata: Metadata;
}) {
  const { supabase, locationId, billingAccountId, ownerUserId, subscription, checkoutSession, metadata } = params;
  const config = await loadRuntimeBillingConfig(supabase as any);
  assertExpectedPrice(config, subscription);

  if (safeGetString(metadata.checkout_purpose) !== "trial_start") return;
  if (safeGetString(subscription?.status) !== "trialing") {
    throw new Error("Checkout session did not create a trialing subscription.");
  }

  const subscriptionId = safeGetString(subscription?.id);
  const trialStartedAt = unixSecondsToIso(subscription?.trial_start) ?? new Date().toISOString();
  const trialEndsAt = unixSecondsToIso(subscription?.trial_end);
  const priceId = firstSubscriptionPriceId(subscription);
  if (!subscriptionId || !trialEndsAt) {
    throw new Error("Stripe trial subscription is missing trial metadata.");
  }

  const intentId = safeGetString(metadata.trial_checkout_intent_id);
  if (intentId) {
    await supabase
      .from("trial_checkout_intents")
      .update({ checkout_session_id: safeGetString(checkoutSession?.id) })
      .eq("id", intentId)
      .eq("business_location_id", locationId);
  }

  await supabase
    .from("business_location_identity")
    .upsert(
      {
        business_location_id: locationId,
        trial_used_at: trialStartedAt,
        trial_started_by_user_id: ownerUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_location_id" },
    );

  const externalReference = `trial:${locationId}:${subscriptionId}`;
  const { data: existingPeriod } = await supabase
    .from("deal_credit_periods")
    .select("id")
    .eq("external_reference", externalReference)
    .maybeSingle();
  if (existingPeriod?.id) {
    await supabase
      .from("location_entitlements")
      .upsert(
        {
          business_location_id: locationId,
          billing_account_id: billingAccountId,
          status: "trial_active",
          entitlement_provider: "stripe",
          trial_started_at: trialStartedAt,
          trial_ends_at: trialEndsAt,
          current_period_started_at: trialStartedAt,
          current_period_ends_at: trialEndsAt,
          cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
          suspended_at: null,
          suspension_reason: null,
          provider_subscription_id: subscriptionId,
          provider_price_id: priceId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_location_id" },
      );
    return;
  }

  const { data: period, error: periodError } = await supabase
    .from("deal_credit_periods")
    .insert({
      business_location_id: locationId,
      source: "trial",
      status: "active",
      starts_at: trialStartedAt,
      ends_at: trialEndsAt,
      credits_granted: config.trialDealCreditAllowance,
      configuration_snapshot: {
        trial_deal_credit_allowance: config.trialDealCreditAllowance,
        credit_reservation_ttl_minutes: config.creditReservationTtlMinutes,
        provider_subscription_id: subscriptionId,
        checkout_session_id: safeGetString(checkoutSession?.id),
        granted_at: new Date().toISOString(),
      },
      external_reference: externalReference,
    })
    .select("id")
    .single();

  if (periodError) {
    const detail = `${periodError.code ?? ""} ${periodError.message ?? ""}`;
    if (!/23505|duplicate/i.test(detail)) throw periodError;
  }

  if (period?.id) {
    const { error: ledgerError } = await supabase
      .from("deal_credit_ledger")
      .insert({
        business_location_id: locationId,
        credit_period_id: period.id,
        event_type: "grant",
        purpose: "admin_adjustment",
        amount: config.trialDealCreditAllowance,
        idempotency_key: externalReference,
        metadata: {
          provider: "stripe",
          subscription_id: subscriptionId,
          checkout_session_id: safeGetString(checkoutSession?.id),
        },
      });
    if (ledgerError) {
      const detail = `${ledgerError.code ?? ""} ${ledgerError.message ?? ""}`;
      if (!/23505|duplicate/i.test(detail)) throw ledgerError;
    }
  }

  await supabase
    .from("location_entitlements")
    .upsert(
      {
        business_location_id: locationId,
        billing_account_id: billingAccountId,
        status: "trial_active",
        entitlement_provider: "stripe",
        trial_started_at: trialStartedAt,
        trial_ends_at: trialEndsAt,
        current_period_started_at: trialStartedAt,
        current_period_ends_at: trialEndsAt,
        cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
        suspended_at: null,
        suspension_reason: null,
        provider_subscription_id: subscriptionId,
        provider_price_id: priceId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_location_id" },
    );
}

async function syncSubscriptionState(params: {
  supabase: any;
  locationId: string;
  billingAccountId: string;
  subscription: any;
  metadata: Metadata;
}) {
  const { supabase, locationId, billingAccountId, subscription, metadata } = params;
  const status = String(subscription?.status ?? "");
  const subscriptionId = safeGetString(subscription?.id);
  const priceId = firstSubscriptionPriceId(subscription);
  const periodEndsAt = unixSecondsToIso(subscription?.current_period_end);
  const periodStartsAt = unixSecondsToIso(subscription?.current_period_start);
  const trialEndsAt = unixSecondsToIso(subscription?.trial_end);
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
  const { data: existing } = await supabase
    .from("location_entitlements")
    .select("first_paid_at,status")
    .eq("business_location_id", locationId)
    .maybeSingle();
  const hasFirstPaid = Boolean(existing?.first_paid_at);
  const existingStatus = safeGetString(existing?.status);
  if (shouldDeferTrialSubscriptionSync(existingStatus, status)) {
    return;
  }

  const nextStatus =
    status === "canceled"
      ? "canceled_suspended"
      : status === "trialing" && cancelAtPeriodEnd
        ? "trial_canceling"
      : status === "trialing"
        ? "trial_active"
      : status === "active" && cancelAtPeriodEnd && hasFirstPaid
        ? "pro_canceling"
      : status === "active" && hasFirstPaid
        ? "pro_active"
      : cancelAtPeriodEnd
        ? "checkout_pending"
        : status === "past_due" || status === "unpaid"
          ? "payment_failed_suspended"
          : "checkout_pending";

  await supabase
    .from("location_entitlements")
    .update({
      billing_account_id: billingAccountId,
      status: nextStatus,
      entitlement_provider: "stripe",
      trial_ends_at: trialEndsAt,
      current_period_started_at: periodStartsAt,
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

function stripeCustomerIdFrom(obj: any, subscription: any): string | null {
  return safeGetString(obj?.customer) ?? safeGetString(subscription?.customer) ?? safeGetString(obj?.id);
}

/**
 * A Stripe Dispute object has no `.customer` field, unlike charges/invoices/
 * subscriptions. Resolve it from the underlying charge (or, failing that, the
 * payment intent) so `businessIdForStripeCustomer` can find the business for
 * `charge.dispute.created`. See findings/03-chargeback-not-handled.md.
 */
async function stripeCustomerIdForDispute(stripe: Stripe, dispute: any): Promise<string | null> {
  const direct = safeGetString(dispute?.customer);
  if (direct) return direct;

  const chargeId = typeof dispute?.charge === "string" ? dispute.charge : safeGetString(dispute?.charge?.id);
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      const customerId = safeGetString(charge?.customer);
      if (customerId) return customerId;
    } catch (err) {
      console.error("[stripe-webhook] dispute charge lookup failed:", err);
    }
  }

  const paymentIntentId =
    typeof dispute?.payment_intent === "string" ? dispute.payment_intent : safeGetString(dispute?.payment_intent?.id);
  if (paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const customerId = safeGetString(paymentIntent?.customer);
      if (customerId) return customerId;
    } catch (err) {
      console.error("[stripe-webhook] dispute payment_intent lookup failed:", err);
    }
  }

  return null;
}

async function businessIdForStripeCustomer(supabase: any, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const { data, error } = await supabase
    .from("business_billing_profiles")
    .select("business_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  return safeGetString(data?.business_id);
}

function businessAccessForStripeStatus(status: string, cancelAtPeriodEnd: boolean): {
  billingStatus: string;
  appAccessStatus: string;
} {
  if (status === "active") return { billingStatus: "active", appAccessStatus: "active" };
  if (status === "trialing") return { billingStatus: "trialing", appAccessStatus: "trialing" };
  if (status === "past_due" || status === "unpaid") return { billingStatus: "past_due", appAccessStatus: "past_due_grace" };
  if (status === "canceled") return { billingStatus: "canceled", appAccessStatus: "canceled" };
  if (status === "paused") return { billingStatus: "paused", appAccessStatus: "suspended" };
  if (status === "incomplete_expired") return { billingStatus: "incomplete_expired", appAccessStatus: "expired" };
  if (status === "incomplete") return { billingStatus: "incomplete", appAccessStatus: "pending" };
  // Finding 07: fail closed on any status Stripe adds that we don't
  // recognize yet -- never grant access on an unrecognized status, even with
  // cancel_at_period_end true. A real active/trialing subscription with
  // auto-renew off is already handled by the explicit branches above; this
  // line is unreachable for any of Stripe's current subscription statuses.
  return { billingStatus: "none", appAccessStatus: "pending" };
}

function invoiceSummary(invoice: any): Record<string, unknown> {
  return compactRecord({
    last_invoice_id: safeGetString(invoice?.id),
    last_invoice_url: safeGetString(invoice?.hosted_invoice_url),
    last_invoice_pdf: safeGetString(invoice?.invoice_pdf),
    last_invoice_status: safeGetString(invoice?.status),
    last_invoice_amount_due_cents: typeof invoice?.amount_due === "number" ? invoice.amount_due : null,
    last_invoice_amount_paid_cents: typeof invoice?.amount_paid === "number" ? invoice.amount_paid : null,
    last_payment_error: safeGetString(invoice?.last_payment_error?.message),
  });
}

async function syncBusinessSubscriptionFromStripe(params: {
  supabase: any;
  businessId: string;
  event: Stripe.Event;
  subscription: any | null;
  invoice?: any | null;
  checkoutSession?: any | null;
  forcePaymentFailure?: boolean;
  /** Chargeback (charge.dispute.created): force an immediate suspension regardless of Stripe subscription status. Never auto-restored — see findings/03-chargeback-not-handled.md. */
  forceChargebackSuspend?: boolean;
}) {
  const { supabase, businessId, event, subscription, invoice, checkoutSession } = params;
  const status = safeGetString(subscription?.status) ?? (params.forcePaymentFailure ? "past_due" : "none");
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
  const metadata: Metadata = {
    ...metadataFrom(subscription),
    ...metadataFrom(checkoutSession ?? invoice ?? {}),
  };
  const access = params.forceChargebackSuspend
    ? { billingStatus: "chargeback", appAccessStatus: "suspended" }
    : businessAccessForStripeStatus(status, cancelAtPeriodEnd);

  // Finding 07: only grantPaidPeriod/activateTrialFromCheckout (the location
  // path) asserted the subscription is on the expected Twofer price before
  // granting access. Do the same here before writing active/trialing for the
  // business path -- a subscription on an unexpected price must not grant
  // access. Throws (like the location path) so the event is recorded failed.
  if (subscription && (status === "active" || status === "trialing" || access.appAccessStatus === "active" || access.appAccessStatus === "trialing")) {
    const priceConfig = await loadRuntimeBillingConfig(supabase as any);
    assertExpectedPrice(priceConfig, subscription);
  }
  const customerId = stripeCustomerIdFrom(checkoutSession ?? invoice ?? {}, subscription);
  const subscriptionId = safeGetString(subscription?.id) ?? safeGetString(checkoutSession?.subscription);
  const priceId = firstSubscriptionPriceId(subscription);
  const graceDays = Math.max(0, Number(Deno.env.get("PAST_DUE_GRACE_DAYS") ?? "3") || 3);
  const now = new Date();
  const graceUntil = params.forcePaymentFailure || access.appAccessStatus === "past_due_grace"
    ? new Date(now.getTime() + graceDays * 86400000).toISOString()
    : null;

  const { data: previous, error: previousError } = await supabase
    .from("business_subscriptions")
    .select("billing_status,app_access_status,trial_type,activated_at,activation_checkout_session_id,activation_provider_event_id,last_provider_event_created_at,last_provider_event_id,access_locked_at,access_locked_reason")
    .eq("business_id", businessId)
    .maybeSingle();
  if (previousError) throw previousError;
  const previousAppAccessStatus = safeGetString(previous?.app_access_status);
  const isCheckoutActivationEvent = event.type === "checkout.session.completed" && isTrialStartCheckout(metadata);
  const previousEventMs = previous?.last_provider_event_created_at
    ? Date.parse(previous.last_provider_event_created_at)
    : Number.NaN;
  const incomingEventMs = event.created * 1000;
  if (Number.isFinite(previousEventMs) && incomingEventMs < previousEventMs) {
    await supabase.from("billing_events").upsert(
      {
        business_id: businessId,
        stripe_event_id: event.id,
        event_source: "stripe",
        event_type: event.type,
        event_created_at: unixSecondsToIso(event.created),
        status_before: safeGetString(previous?.billing_status),
        status_after: safeGetString(previous?.billing_status),
        app_access_before: previousAppAccessStatus,
        app_access_after: previousAppAccessStatus,
        processing_status: "ignored_duplicate",
        raw_event: event,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "stripe_event_id" },
    );
    return;
  }
  const deferInitialTrialUnlock =
    event.type !== "checkout.session.completed" &&
    shouldDeferTrialSubscriptionSync(previousAppAccessStatus, status);

  if (event.type === "checkout.session.completed") {
    if (!isTrialStartCheckout(metadata)) {
      throw new Error("Checkout session is not a trial activation session.");
    }
    if (status !== "trialing") {
      throw new Error("Checkout session did not create a trialing subscription.");
    }
  }
  const effectiveAccess = deferInitialTrialUnlock
    ? {
        billingStatus: access.billingStatus,
        appAccessStatus: previousAppAccessStatus ?? "pending",
      }
    : access;
  const accessIsLocked = Boolean(previous?.access_locked_at);
  const wouldRestoreLockedAccess =
    accessIsLocked &&
    ["trialing", "active", "past_due_grace"].includes(effectiveAccess.appAccessStatus) &&
    event.type !== "checkout.session.completed";
  const orderedAccess = wouldRestoreLockedAccess
    ? {
        billingStatus: safeGetString(previous?.billing_status) ?? effectiveAccess.billingStatus,
        appAccessStatus: previousAppAccessStatus ?? "suspended",
      }
    : effectiveAccess;

  // Preserve "was this ever a paying/trialing subscription" across terminal
  // events: Stripe's own status on a canceled subscription no longer says
  // "active" or "trialing", so trial_type would otherwise collapse to null
  // right when the downgrade path needs it most.
  const trialType = orderedAccess.appAccessStatus === "trialing"
    ? "stripe_trial"
    : orderedAccess.appAccessStatus === "active"
      ? "paid"
      : safeGetString(previous?.trial_type);
  const trialStartIso = unixSecondsToIso(subscription?.trial_start);
  const trialEndIso = unixSecondsToIso(subscription?.trial_end);
  const currentPeriodStartIso = unixSecondsToIso(subscription?.current_period_start);
  const currentPeriodEndIso = unixSecondsToIso(subscription?.current_period_end);

  const { error: subscriptionSyncError } = await supabase.from("business_subscriptions").upsert(
    {
      business_id: businessId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_product_id: safeGetString(subscription?.items?.data?.[0]?.price?.product),
      stripe_price_id: priceId,
      billing_mode: "web_stripe",
      billing_status: orderedAccess.billingStatus,
      app_access_status: orderedAccess.appAccessStatus,
      trial_type: trialType,
      trial_start: trialStartIso,
      trial_end: trialEndIso,
      current_period_start: currentPeriodStartIso,
      current_period_end: currentPeriodEndIso,
      cancel_at_period_end: cancelAtPeriodEnd,
      canceled_at: unixSecondsToIso(subscription?.canceled_at),
      ended_at: unixSecondsToIso(subscription?.ended_at),
      grace_period_until: graceUntil,
      past_due_since: access.billingStatus === "past_due" ? now.toISOString() : null,
      payment_method_status: access.billingStatus === "past_due" ? "failed" : "unknown",
      activated_at: isCheckoutActivationEvent ? now.toISOString() : previous?.activated_at ?? null,
      activation_checkout_session_id: isCheckoutActivationEvent
        ? safeGetString(checkoutSession?.id)
        : safeGetString(previous?.activation_checkout_session_id),
      activation_provider_event_id: isCheckoutActivationEvent
        ? event.id
        : safeGetString(previous?.activation_provider_event_id),
      last_provider_event_created_at: unixSecondsToIso(event.created),
      last_provider_event_id: event.id,
      access_locked_at: params.forceChargebackSuspend
        ? now.toISOString()
        : previous?.access_locked_at ?? null,
      access_locked_reason: params.forceChargebackSuspend
        ? "chargeback"
        : safeGetString(previous?.access_locked_reason),
      ...invoiceSummary(invoice),
      source: "stripe_webhook",
      metadata: compactRecord({
        stripe_event_type: event.type,
        checkout_session_id: safeGetString(checkoutSession?.id),
      }),
      updated_at: now.toISOString(),
    },
    { onConflict: "business_id" },
  );
  if (subscriptionSyncError) throw subscriptionSyncError;

  if (customerId) {
    await supabase
      .from("business_billing_profiles")
      .update({
        stripe_customer_id: customerId,
        stripe_customer_livemode: event.livemode,
        stripe_sync_status: "synced",
        stripe_sync_error: null,
        last_synced_from_stripe_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("business_id", businessId);
  }

  if (checkoutSession?.id) {
    await supabase
      .from("stripe_checkout_sessions")
      .update({
        stripe_subscription_id: subscriptionId,
        status: event.type === "checkout.session.completed" ? "completed" : "opened",
        completed_at: event.type === "checkout.session.completed" ? now.toISOString() : null,
        updated_at: now.toISOString(),
      })
      .eq("stripe_checkout_session_id", checkoutSession.id);
  }

  await supabase.from("billing_events").upsert(
    {
      business_id: businessId,
      stripe_event_id: event.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_checkout_session_id: safeGetString(checkoutSession?.id),
      stripe_invoice_id: safeGetString(invoice?.id),
      stripe_payment_intent_id: stripeReferenceId(invoice?.payment_intent),
      event_source: "stripe",
      event_type: event.type,
      event_created_at: unixSecondsToIso(event.created),
      status_before: safeGetString(previous?.billing_status),
      status_after: orderedAccess.billingStatus,
      app_access_before: safeGetString(previous?.app_access_status),
      app_access_after: orderedAccess.appAccessStatus,
      processing_status: "processed",
      raw_event: event,
      processed_at: now.toISOString(),
    },
    { onConflict: "stripe_event_id" },
  );

  // Keeps businesses.access_level, businesses.status, and location_entitlements
  // (what the app gate and publish checks actually read) in sync with the
  // business_subscriptions row just written above. Canceled/expired/past-due
  // statuses now explicitly downgrade instead of being skipped.
  await applyBusinessBillingAccessState({
    supabase,
    businessId,
    provider: "stripe",
    appAccessStatus: orderedAccess.appAccessStatus,
    trialType,
    trialStart: trialStartIso,
    trialEnd: trialEndIso,
    currentPeriodStart: currentPeriodStartIso,
    currentPeriodEnd: currentPeriodEndIso,
    cancelAtPeriodEnd,
  });

  // No-card trial bookkeeping: mark this physical location's trial as used
  // the moment a real trialing subscription is confirmed, mirroring what
  // admin_grant_location_trial / activateTrialFromCheckout already do for
  // their own paths. This is what stripe-create-checkout-session's reuse
  // guard checks before granting a second no-card trial to the same
  // storefront. (Unlike admin_grant_location_trial's raw SQL COALESCE, this
  // upsert overwrites trial_used_at on every trialing event; harmless in
  // practice since trial_start doesn't change mid-trial, and all the reuse
  // guard needs is non-null.)
  if (orderedAccess.appAccessStatus === "trialing") {
    const locationId = await ensurePrimaryBusinessLocationId(supabase, businessId);
    if (locationId) {
      await supabase.from("business_location_identity").upsert(
        {
          business_location_id: locationId,
          trial_used_at: trialStartIso ?? now.toISOString(),
          updated_at: now.toISOString(),
        },
        { onConflict: "business_location_id" },
      );
    }
  }
}

async function syncBusinessCustomerProfileFromStripe(params: {
  supabase: any;
  businessId: string;
  event: Stripe.Event;
  customer: any;
}) {
  const customer = params.customer;
  const address = customer?.address ?? {};
  await params.supabase
    .from("business_billing_profiles")
    .update({
      billing_name: safeGetString(customer?.name),
      billing_email: safeGetString(customer?.email),
      billing_phone: safeGetString(customer?.phone),
      billing_address_line1: safeGetString(address.line1),
      billing_address_line2: safeGetString(address.line2),
      billing_city: safeGetString(address.city),
      billing_state: safeGetString(address.state),
      billing_postal_code: safeGetString(address.postal_code),
      billing_country: safeGetString(address.country) ?? "US",
      stripe_sync_status: "synced",
      last_synced_from_stripe_at: new Date().toISOString(),
      billing_fields_source: {
        billing_name: "stripe_portal",
        billing_email: "stripe_portal",
        billing_phone: "stripe_portal",
        billing_address_line1: "stripe_portal",
        billing_city: "stripe_portal",
        billing_state: "stripe_portal",
        billing_postal_code: "stripe_portal",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", params.businessId);

  await params.supabase.from("billing_events").upsert(
    {
      business_id: params.businessId,
      stripe_event_id: params.event.id,
      stripe_customer_id: safeGetString(customer?.id),
      event_source: "stripe",
      event_type: params.event.type,
      event_created_at: unixSecondsToIso(params.event.created),
      status_after: "customer_profile_synced",
      processing_status: "processed",
      raw_event: params.event,
      processed_at: new Date().toISOString(),
    },
    { onConflict: "stripe_event_id" },
  );
}

async function expireBusinessActivationCheckout(params: {
  supabase: any;
  businessId: string;
  event: Stripe.Event;
  checkoutSession: any;
}) {
  const sessionId = safeGetString(params.checkoutSession?.id);
  if (!sessionId) throw new Error("Expired Checkout Session is missing its id.");
  const { data: updated, error } = await params.supabase
    .from("stripe_checkout_sessions")
    .update({
      status: "expired",
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", params.businessId)
    .eq("stripe_checkout_session_id", sessionId)
    .in("status", ["created", "opened"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new Error("Expired Checkout Session did not match an open local activation session.");

  const { error: expirationEventError } = await params.supabase.from("billing_events").upsert(
    {
      business_id: params.businessId,
      stripe_event_id: params.event.id,
      stripe_customer_id: safeGetString(params.checkoutSession?.customer),
      stripe_checkout_session_id: sessionId,
      event_source: "stripe",
      event_type: params.event.type,
      event_created_at: unixSecondsToIso(params.event.created),
      status_after: "checkout_expired",
      app_access_after: "approved_not_activated",
      processing_status: "processed",
      raw_event: params.event,
      processed_at: new Date().toISOString(),
    },
    { onConflict: "stripe_event_id" },
  );
  if (expirationEventError) throw expirationEventError;
}

async function activateBusinessTrialCheckout(params: {
  supabase: any;
  stripe: Stripe;
  config: RuntimeBillingConfig;
  event: Stripe.Event;
  eventSession: any;
  businessId: string;
}) {
  const sessionId = safeGetString(params.eventSession?.id);
  if (!sessionId) throw new Error("Checkout Session is missing its id.");
  const checkoutSession: any = await params.stripe.checkout.sessions.retrieve(sessionId);
  const metadata = metadataFrom(checkoutSession);
  if (!isTrialStartCheckout(metadata)) {
    throw new Error("Checkout session is not a trial activation session.");
  }
  if (safeGetString(checkoutSession?.mode) !== "subscription" || safeGetString(checkoutSession?.status) !== "complete") {
    throw new Error("Checkout session is not a completed subscription Checkout.");
  }

  const subscriptionId = stripeReferenceId(checkoutSession?.subscription);
  if (!subscriptionId) throw new Error("Checkout Session is missing its subscription.");
  const subscription: any = await params.stripe.subscriptions.retrieve(subscriptionId);
  if (safeGetString(subscription?.status) !== "trialing") {
    throw new Error("Checkout session did not create a trialing subscription.");
  }
  assertExpectedPrice(params.config, subscription);

  const applicationId = safeGetString(metadata.application_id);
  const metadataBusinessId = safeGetString(metadata.business_id);
  const customerId = stripeCustomerIdFrom(checkoutSession, subscription);
  const trialStart = unixSecondsToIso(subscription?.trial_start);
  const trialEnd = unixSecondsToIso(subscription?.trial_end);
  if (!applicationId || metadataBusinessId !== params.businessId || !customerId || !trialStart || !trialEnd) {
    throw new Error("Checkout activation metadata is incomplete.");
  }

  const { data, error } = await params.supabase.rpc("activate_business_trial_from_checkout", {
    p_business_id: params.businessId,
    p_application_id: applicationId,
    p_checkout_session_id: sessionId,
    p_provider_event_id: params.event.id,
    p_provider_event_created_at: unixSecondsToIso(params.event.created),
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_stripe_product_id: safeGetString(subscription?.items?.data?.[0]?.price?.product),
    p_stripe_price_id: firstSubscriptionPriceId(subscription),
    p_trial_start: trialStart,
    p_trial_end: trialEnd,
    p_current_period_start: unixSecondsToIso(subscription?.current_period_start),
    p_current_period_end: unixSecondsToIso(subscription?.current_period_end),
    p_cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    p_livemode: params.event.livemode,
    p_checkout_mode: safeGetString(checkoutSession?.mode),
    p_checkout_status: safeGetString(checkoutSession?.status),
  });
  if (error) throw error;

  const { error: activationEventError } = await params.supabase.from("billing_events").upsert(
    {
      business_id: params.businessId,
      stripe_event_id: params.event.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_checkout_session_id: sessionId,
      event_source: "stripe",
      event_type: params.event.type,
      event_created_at: unixSecondsToIso(params.event.created),
      status_before: "none",
      status_after: "trialing",
      app_access_before: "approved_not_activated",
      app_access_after: "trialing",
      processing_status: "processed",
      raw_event: params.event,
      processed_at: new Date().toISOString(),
    },
    { onConflict: "stripe_event_id" },
  );
  if (activationEventError) throw activationEventError;
  return data;
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
  const supabaseServiceKey = getServiceRoleKey();
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
  const config = await loadRuntimeBillingConfig(supabase as any);
  const expectedLivemode = config.billingEnvironment === "production";
  if (event.livemode !== expectedLivemode) {
    return jsonResponse(req, { error: "Stripe event mode does not match the billing environment." }, 400);
  }
  const obj: any = event.data.object;
  const subscription = await fetchSubscriptionForEvent(stripe, event.type, obj);
  const mergedMetadata: Metadata = {
    ...metadataFrom(subscription),
    ...metadataFrom(obj),
    ...(event.type === "charge.refunded" ? refundMetadataFromCharge(obj) : {}),
  };
  const environment = eventEnvironment(event, mergedMetadata);
  if (environment !== config.billingEnvironment) {
    return jsonResponse(req, { error: "Stripe event environment is not accepted." }, 400);
  }
  const providerEvent = await insertProviderEvent(supabase, event, environment);
  if (providerEvent.duplicate) {
    return jsonResponse(req, { received: true, duplicate: true });
  }

  try {
    const metadataLocationId = safeGetString(mergedMetadata.business_location_id);
    const metadataBillingAccountId = safeGetString(mergedMetadata.billing_account_id);
    const eventCustomerId =
      event.type === "charge.dispute.created"
        ? await stripeCustomerIdForDispute(stripe, obj)
        : stripeCustomerIdFrom(obj, subscription);
    const metadataBusinessId = safeGetString(mergedMetadata.business_id);
    const businessId = metadataBusinessId ?? await businessIdForStripeCustomer(supabase, eventCustomerId);

    if (businessId && !isRefundWebhookEvent(event.type)) {
      if (event.type === "checkout.session.completed") {
        const activation = await activateBusinessTrialCheckout({
          supabase,
          stripe,
          config,
          event,
          eventSession: obj,
          businessId,
        });
        await markProviderEvent(supabase, providerEvent.id, "processed");
        return jsonResponse(req, { received: true, business_id: businessId, activation });
      } else if (event.type === "checkout.session.expired") {
        await expireBusinessActivationCheckout({
          supabase,
          businessId,
          event,
          checkoutSession: obj,
        });
      } else if (event.type === "customer.updated") {
        await syncBusinessCustomerProfileFromStripe({ supabase, businessId, event, customer: obj });
      } else if (
        event.type === "invoice.paid" ||
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        await syncBusinessSubscriptionFromStripe({
          supabase,
          businessId,
          event,
          subscription,
          invoice: event.type === "invoice.paid" ? obj : null,
        });
        if (event.type === "invoice.paid" && isRealPaidSubscriptionCycleInvoice(obj)) {
          const capabilities = await getBusinessCapabilities(supabase, businessId);
          if (!capabilities.can_consume_offer_credits) {
            throw new Error("BUSINESS_OFFER_CREDIT_CAPABILITY_REQUIRED");
          }
          const locationId = await ensurePrimaryBusinessLocationId(supabase, businessId);
          if (!locationId) throw new Error("Primary business location is required for paid credits.");
          const { data: entitlement, error: entitlementError } = await supabase
            .from("location_entitlements")
            .select("billing_account_id")
            .eq("business_location_id", locationId)
            .maybeSingle();
          if (entitlementError) throw entitlementError;
          const billingAccountId = safeGetString(entitlement?.billing_account_id);
          if (!billingAccountId) throw new Error("Billing account is required for paid credits.");
          await grantPaidPeriod({
            supabase,
            locationId,
            billingAccountId,
            subscription,
            invoice: obj,
          });
        }
      } else if (event.type === "invoice.payment_failed") {
        await syncBusinessSubscriptionFromStripe({
          supabase,
          businessId,
          event,
          subscription,
          invoice: obj,
          forcePaymentFailure: true,
        });
        await supabase.from("billing_reminders").insert({
          business_id: businessId,
          reminder_type: "payment_failed",
          channel: "email",
          status: "pending",
          scheduled_for: new Date().toISOString(),
          idempotency_key: `payment_failed:${event.id}`,
          metadata: {
            stripe_invoice_id: safeGetString(obj?.id),
            stripe_subscription_id: safeGetString(subscription?.id),
          },
        });
      } else if (event.type === "charge.dispute.created") {
        // Chargeback: suspend immediately. NO auto-restore on
        // charge.dispute.closed (Dan confirmed 2026-07-06) -- that event type
        // is intentionally not handled here, so it falls through to
        // markProviderEvent below for audit logging only, with no state change.
        await syncBusinessSubscriptionFromStripe({
          supabase,
          businessId,
          event,
          subscription,
          forceChargebackSuspend: true,
        });
      }

      await markProviderEvent(supabase, providerEvent.id, "processed");
      return jsonResponse(req, { received: true, business_id: businessId });
    }

    if (isRefundWebhookEvent(event.type)) {
      const refundContext = await recordRefundWebhookDetails({
        supabase,
        eventType: event.type,
        providerEventId: event.id,
        obj,
        metadata: mergedMetadata,
        locationId: metadataLocationId,
        billingAccountId: metadataBillingAccountId,
      });
      if (businessId) {
        const lockedAt = new Date().toISOString();
        const { error: subscriptionLockError } = await supabase
          .from("business_subscriptions")
          .update({
            app_access_status: "suspended",
            access_locked_at: lockedAt,
            access_locked_reason: "refund",
            last_provider_event_created_at: unixSecondsToIso(event.created),
            last_provider_event_id: event.id,
            updated_at: lockedAt,
          })
          .eq("business_id", businessId);
        if (subscriptionLockError) throw subscriptionLockError;
        const { error: businessLockError } = await supabase
          .from("businesses")
          .update({
            status: "suspended",
            access_level: "none",
            suspended_at: lockedAt,
            suspension_reason: "refund",
            updated_at: lockedAt,
          })
          .eq("id", businessId);
        if (businessLockError) throw businessLockError;
        const { error: applicationLockError } = await supabase
          .from("business_applications")
          .update({
            status: "suspended",
            access_tier: "suspended",
            updated_at: lockedAt,
          })
          .eq("business_id", businessId);
        if (applicationLockError) throw applicationLockError;
      }
      if (!refundContext.locationId) {
        await markProviderEvent(supabase, providerEvent.id, "processed");
        return jsonResponse(req, { received: true, skipped: true });
      }

      const customerId = safeGetString(obj?.customer) ?? safeGetString(subscription?.customer);
      if (customerId && refundContext.billingAccountId) {
        await supabase
          .from("billing_accounts")
          .update({
            provider: "stripe",
            provider_customer_id: customerId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", refundContext.billingAccountId);
      }

      const now = new Date().toISOString();
      const isIntroductoryRefund =
        safeGetString(mergedMetadata.refund_purpose) === "introductory_first_paid_invoice";
      const { error: locationRefundError } = await supabase
        .from("location_entitlements")
        .update({
          ...(refundContext.billingAccountId ? { billing_account_id: refundContext.billingAccountId } : {}),
          status: "refunded_suspended",
          suspended_at: now,
          suspension_reason: isIntroductoryRefund ? "introductory_refund" : "refunded",
          ...(isIntroductoryRefund ? { introductory_refund_used_at: now } : {}),
          updated_at: now,
        })
        .eq("business_location_id", refundContext.locationId);
      if (locationRefundError) throw locationRefundError;

      await markProviderEvent(supabase, providerEvent.id, "processed");
      return jsonResponse(req, { received: true });
    }

    const locationId = metadataLocationId;
    const billingAccountId = metadataBillingAccountId;
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

    if (event.type === "checkout.session.completed") {
      const ownerUserId = safeGetString(mergedMetadata.owner_user_id);
      if (!ownerUserId) throw new Error("Missing owner metadata for trial checkout.");
      await activateTrialFromCheckout({
        supabase,
        locationId,
        billingAccountId,
        ownerUserId,
        subscription,
        checkoutSession: obj,
        metadata: mergedMetadata,
      });
    } else if (event.type === "invoice.paid") {
      await grantPaidPeriod({ supabase, locationId, billingAccountId, subscription, invoice: obj });
    } else if (event.type === "invoice.payment_failed") {
      const { data: existing } = await supabase
        .from("location_entitlements")
        .select("first_paid_at")
        .eq("business_location_id", locationId)
        .maybeSingle();
      const failedStatus = existing?.first_paid_at
        ? "payment_failed_suspended"
        : "trial_expired_payment_failed_suspended";
      await supabase
        .from("location_entitlements")
        .update({
          billing_account_id: billingAccountId,
          status: failedStatus,
          entitlement_provider: "stripe",
          suspended_at: new Date().toISOString(),
          suspension_reason: "payment_failed",
          provider_subscription_id: safeGetString(subscription?.id),
          updated_at: new Date().toISOString(),
        })
        .eq("business_location_id", locationId);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated"
    ) {
      await syncSubscriptionState({ supabase, locationId, billingAccountId, subscription, metadata: mergedMetadata });
    } else if (event.type === "customer.subscription.deleted") {
      const { data: existing } = await supabase
        .from("location_entitlements")
        .select("first_paid_at")
        .eq("business_location_id", locationId)
        .maybeSingle();
      await supabase
        .from("location_entitlements")
        .update({
          billing_account_id: billingAccountId,
          status: existing?.first_paid_at ? "canceled_suspended" : "trial_canceled",
          entitlement_provider: "stripe",
          current_period_ends_at: unixSecondsToIso(subscription?.current_period_end),
          cancel_at_period_end: false,
          suspended_at: existing?.first_paid_at ? new Date().toISOString() : null,
          suspension_reason: existing?.first_paid_at ? "subscription_deleted" : null,
          provider_subscription_id: safeGetString(subscription?.id),
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
