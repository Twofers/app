import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

type AppSubscriptionStatus = "trial" | "active" | "past_due" | "canceled";
type AppSubscriptionTier = "pro" | "premium";

function mapStripeStatusToApp(status: string | null | undefined): AppSubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trial";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "past_due";
  }
}

function unixSecondsToIso(ts: number | null | undefined): string | null {
  if (!ts || !Number.isFinite(ts)) return null;
  return new Date(ts * 1000).toISOString();
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")!;
  const stripeWebhookSecret =
    Deno.env.get("STRIPE_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET");
  if (!stripeWebhookSecret) {
    return new Response(
      JSON.stringify({ error: "Missing Stripe webhook signing secret." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid Stripe webhook signature." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    console.log("[stripe-webhook] received event", event.type, event.id);
    if (
      event.type !== "customer.subscription.created" &&
      event.type !== "customer.subscription.updated" &&
      event.type !== "customer.subscription.deleted" &&
      event.type !== "invoice.payment_succeeded"
    ) {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const eventObj: any = event.data.object;
    let subscriptionId: string | null = null;
    let customerId: string | null = null;
    let subscriptionForUpdate: any = null;

    if (event.type === "invoice.payment_succeeded") {
      subscriptionId = eventObj?.subscription ?? null;
      const cust = eventObj?.customer;
      customerId = !cust ? null : typeof cust === "string" ? cust : cust?.id ?? null;
      if (subscriptionId) {
        subscriptionForUpdate = await stripe.subscriptions.retrieve(subscriptionId);
      }
    } else {
      subscriptionId = eventObj?.id ?? null;
      const cust = eventObj?.customer;
      customerId = !cust ? null : typeof cust === "string" ? cust : cust?.id ?? null;
      subscriptionForUpdate = eventObj;
    }

    if (!subscriptionId || !customerId || !subscriptionForUpdate) {
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pricing -> tier mapping uses `app_config` so future price changes work without code edits.
    const { data: config } = await supabase
      .from("app_config")
      .select("pro_monthly_price,premium_monthly_price")
      .maybeSingle();

    const proMonthly = config?.pro_monthly_price ?? null;
    const premiumMonthly = config?.premium_monthly_price ?? null;

    const unitsAmount = (() => {
      // subscription object (preferred)
      const items = subscriptionForUpdate?.items?.data;
      const first = Array.isArray(items) ? items[0] : null;
      const unitAmount = first?.price?.unit_amount ?? null;
      return typeof unitAmount === "number" ? unitAmount : null;
    })();
    const proCents = proMonthly != null ? Math.round(Number(proMonthly) * 100) : null;
    const premiumCents = premiumMonthly != null ? Math.round(Number(premiumMonthly) * 100) : null;

    /** Resolve tier from the unit amount. Returns null if the amount doesn't match a known
     * tier — the caller should skip processing in that case rather than default-grant. */
    const subscriptionTier: AppSubscriptionTier | null = (() => {
      if (unitsAmount == null) return null;
      if (premiumCents != null && unitsAmount === premiumCents) return "premium";
      if (proCents != null && unitsAmount === proCents) return "pro";
      return null;
    })();

    if (subscriptionTier == null) {
      console.warn(
        "[stripe-webhook] unknown unit amount, skipping (event:",
        event.id,
        ", amount:",
        unitsAmount,
        ", proCents:",
        proCents,
        ", premiumCents:",
        premiumCents,
        ")",
      );
      return new Response(
        JSON.stringify({ received: true, skipped: true, reason: "unknown_tier_amount" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripeStatus = subscriptionForUpdate?.status ?? null;
    const appSubscriptionStatus: AppSubscriptionStatus = mapStripeStatusToApp(
      stripeStatus,
    );

    // trial_end and current_period_end are unix timestamps (seconds) on Stripe objects.
    const trialEndsAt = unixSecondsToIso(subscriptionForUpdate?.trial_end);
    const currentPeriodEndsAt = unixSecondsToIso(subscriptionForUpdate?.current_period_end);

    // Find matching business_profiles: prefer by subscription id, fall back to customer id.
    let businessProfileRow: { id: string; owner_id: string | null } | null = null;
    const { data: bySub } = await supabase
      .from("business_profiles")
      .select("id,owner_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (bySub?.id) businessProfileRow = { id: bySub.id, owner_id: bySub.owner_id ?? null };

    if (!businessProfileRow) {
      const { data: byCust } = await supabase
        .from("business_profiles")
        .select("id,owner_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (byCust?.id) businessProfileRow = { id: byCust.id, owner_id: byCust.owner_id ?? null };
    }

    if (!businessProfileRow) {
      return new Response(JSON.stringify({ received: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency — if we've already processed this Stripe event, the unique index on
    // subscription_history(stripe_event_id) makes the INSERT a no-op. We then skip the
    // business_profiles UPDATE so an out-of-order replay can't clobber newer state.
    const { data: insertedHistory, error: histErr } = await supabase
      .from("subscription_history")
      .upsert(
        {
          business_profile_id: businessProfileRow.id,
          stripe_event_type: event.type,
          stripe_event_id: event.id,
          subscription_tier: subscriptionTier,
          subscription_status: appSubscriptionStatus,
          stripe_subscription_id: subscriptionId,
          payload: event,
        },
        { onConflict: "stripe_event_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    if (histErr) {
      console.error("[stripe-webhook] subscription_history upsert failed:", histErr);
    }

    if (!insertedHistory) {
      console.log("[stripe-webhook] event already processed, skipping update:", event.id);
      return new Response(
        JSON.stringify({ received: true, skipped: true, reason: "duplicate_event" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const updatePayload: Record<string, unknown> = {
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: appSubscriptionStatus,
      subscription_tier: subscriptionTier,
      ...(currentPeriodEndsAt ? { current_period_ends_at: currentPeriodEndsAt } : {}),
      ...(trialEndsAt ? { trial_ends_at: trialEndsAt } : {}),
    };

    await supabase
      .from("business_profiles")
      .update(updatePayload)
      .eq("id", businessProfileRow.id);
    console.log(
      "[stripe-webhook] updated business_profile",
      businessProfileRow.id,
      "status=",
      appSubscriptionStatus,
      "tier=",
      subscriptionTier,
    );

    // Keep legacy `businesses.subscription_tier` in sync (some client code reads it as fallback).
    if (subscriptionTier && businessProfileRow.owner_id) {
      try {
        await supabase
          .from("businesses")
          .update({ subscription_tier: subscriptionTier })
          .eq("owner_id", businessProfileRow.owner_id);
      } catch {
        // best-effort — canonical source is business_profiles
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[stripe-webhook] error:", err);
    return new Response(JSON.stringify({ error: "Webhook handler failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

