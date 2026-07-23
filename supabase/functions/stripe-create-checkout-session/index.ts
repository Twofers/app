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
import {
  ensureStripeCustomerForBusiness,
  type BusinessBillingProfileInput,
} from "../_shared/stripe-business-billing.ts";
import { ensurePrimaryBusinessLocationId } from "../_shared/business-location-entitlement-sync.ts";

type BillingSource = "admin" | "website" | "email";
const STANDARD_TRIAL_DAYS = 30;

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Audit F-005: the request body may only *ask* for a source; the effective
// source is derived server-side below (token => "email"; "admin" only with a
// verified active admin role; everything else => "website"). "test" no longer
// exists as a source.
function billingSource(value: unknown): BillingSource {
  const source = safeGetString(value);
  return source === "admin" || source === "website" || source === "email" ? source : "website";
}

function safeWebUrl(value: unknown, fallback: string): string {
  const raw = safeGetString(value);
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")) return url.toString();
  } catch {
    // fall through
  }
  return fallback;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Manual override for the card requirement (and the trial-reuse guard below),
 * e.g. for launch partners Dan wants into a no-card trial regardless of the
 * global app_runtime_config.require_card_for_trial switch. Single atomic
 * UPDATE...RETURNING so a popular/shared code can't be raced past max_uses.
 */
async function consumeTrialNoCardExemptionCode(supabaseAdmin: any, rawCode: string | null): Promise<boolean> {
  const trimmed = typeof rawCode === "string" ? rawCode.trim() : "";
  if (!trimmed) return false;
  const codeHash = await sha256Hex(trimmed);
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin.rpc("consume_trial_no_card_exemption_code", {
    p_code_hash: codeHash,
    p_now: nowIso,
  });
  if (error) {
    console.error("[stripe-create-checkout-session] exemption code check failed:", error);
    return false;
  }
  return data === true;
}

/**
 * Finding 05: the automatic (code-less) no-card path must still respect
 * one-trial-per-physical-location. Mirrors admin_grant_location_trial's own
 * two checks exactly so a merchant can't get a second free ride by starting a
 * new business at the same storefront.
 */
async function isBusinessLocationTrialAlreadyUsed(supabaseAdmin: any, locationId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("deal_credit_periods")
    .select("id", { count: "exact", head: true })
    .eq("business_location_id", locationId)
    .in("source", ["trial", "admin_trial"]);
  if (typeof count === "number" && count > 0) return true;

  const { data, error } = await supabaseAdmin.rpc("check_business_location_trial_reuse", {
    p_business_location_id: locationId,
  });
  if (error) {
    console.error("[stripe-create-checkout-session] trial reuse check failed:", error);
    return false;
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.some((row: { decision?: string }) => row.decision === "block" || row.decision === "review");
}

async function activeAdminRole(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("admin_users")
    .select("role,is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.is_active ? safeGetString(data.role) : null;
}

function adminCanCreateCheckout(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "finance";
}

async function userCanBillBusiness(supabase: any, businessId: string, userId: string, source: BillingSource): Promise<{
  ok: boolean;
  adminRole: string | null;
}> {
  const adminRole = await activeAdminRole(supabase, userId);
  if (source === "admin") return { ok: adminCanCreateCheckout(adminRole), adminRole };
  if (adminRole && adminCanCreateCheckout(adminRole)) return { ok: true, adminRole };

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  if (business?.owner_id === userId) return { ok: true, adminRole: null };

  const { data: member, error: memberError } = await supabase
    .from("business_members")
    .select("id,role,status")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager"])
    .maybeSingle();
  if (memberError) throw memberError;
  return { ok: Boolean(member?.id), adminRole: null };
}

/**
 * Audit F-006: consume the emailed billing token in ONE atomic conditional
 * UPDATE (consume_billing_token RPC, migration 20260813120000) so concurrent
 * replays of a single-use token cannot each create a Checkout Session. Fails
 * closed on any RPC error, mirroring consumeTrialNoCardExemptionCode above.
 */
async function useBillingToken(supabase: any, businessId: string, rawToken: string | null): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await supabase.rpc("consume_billing_token", {
    p_business_id: businessId,
    p_token_hash: tokenHash,
    p_action: "subscription_checkout",
  });
  if (error) {
    // Code + message only — never the raw error object, which can echo RPC
    // arguments (token hash, business id) into platform logs.
    console.error("[stripe-create-checkout-session] billing_tokens consume failed:", error.code ?? "", error.message ?? "");
    return false;
  }
  return data === true;
}

async function loadBillingInput(supabase: any, businessId: string): Promise<BusinessBillingProfileInput> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id,owner_id,name,contact_name,business_email,public_email,phone,address")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  if (!business?.id) throw new Error("BUSINESS_NOT_FOUND");

  const { data: billingProfile, error: billingError } = await supabase
    .from("business_billing_profiles")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (billingError) throw billingError;

  return {
    businessId,
    ownerUserId: safeGetString(business.owner_id),
    billingName: safeGetString(billingProfile?.billing_name) ?? safeGetString(business.name),
    billingEmail: safeGetString(billingProfile?.billing_email) ??
      safeGetString(business.business_email) ??
      safeGetString(business.public_email),
    billingPhone: safeGetString(billingProfile?.billing_phone) ?? safeGetString(business.phone),
    billingAddressLine1: safeGetString(billingProfile?.billing_address_line1) ?? safeGetString(business.address),
    billingAddressLine2: safeGetString(billingProfile?.billing_address_line2),
    billingCity: safeGetString(billingProfile?.billing_city),
    billingState: safeGetString(billingProfile?.billing_state),
    billingPostalCode: safeGetString(billingProfile?.billing_postal_code),
    billingCountry: safeGetString(billingProfile?.billing_country) ?? "US",
    billingContactName: safeGetString(billingProfile?.billing_contact_name) ?? safeGetString(business.contact_name),
    onboardingSource: safeGetString(billingProfile?.onboarding_source) ?? "web_billing_checkout",
    preferredPlan: safeGetString(billingProfile?.preferred_plan) ?? "twofer_pro_monthly",
  };
}

async function assertBusinessCanStartTrialCheckout(supabase: any, businessId: string): Promise<string> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("status,access_level")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  if (!business) throw new Error("BUSINESS_NOT_FOUND");

  const { data: subscription, error: subscriptionError } = await supabase
    .from("business_subscriptions")
    .select("app_access_status,activated_at,stripe_subscription_id,trial_type")
    .eq("business_id", businessId)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;

  const businessStatus = safeGetString(business.status);
  const accessLevel = safeGetString(business.access_level);
  const appAccessStatus = safeGetString(subscription?.app_access_status);
  const alreadyActivated = Boolean(subscription?.activated_at);
  const alreadyHasProviderSubscription = Boolean(safeGetString(subscription?.stripe_subscription_id));
  const activeAccess = new Set(["trial_limited", "trialing", "active", "past_due_grace", "comped"]);

  // An admin-granted (approve_full_access) trial is access without billing: it
  // has no Stripe customer or subscription behind it and it runs out on its own.
  // Those owners are exactly the ones we want converting to paid, so a card-free
  // admin trial is checkout-eligible rather than "already activated". A trial
  // that came from Stripe, or any business that has ever activated, still is not.
  const onCardFreeAdminTrial = appAccessStatus === "trialing" &&
    safeGetString(subscription?.trial_type) === "admin_comp" &&
    !alreadyActivated &&
    !alreadyHasProviderSubscription;

  if (
    alreadyActivated ||
    alreadyHasProviderSubscription ||
    (appAccessStatus && activeAccess.has(appAccessStatus) && !onCardFreeAdminTrial)
  ) {
    throw new Error("BUSINESS_ALREADY_ACTIVATED");
  }
  if (
    !onCardFreeAdminTrial &&
    businessStatus !== "approved_not_activated" &&
    accessLevel !== "approved_not_activated" &&
    appAccessStatus !== "approved_not_activated"
  ) {
    throw new Error("BUSINESS_NOT_APPROVED_FOR_ACTIVATION");
  }

  // Applying an admin grant moves the application to `trial_active` (the billing
  // mirror in applyBusinessBillingAccessState does it), so restricting this to
  // approved_not_activated would leave every comped owner unable to convert.
  const claimableStatuses = onCardFreeAdminTrial
    ? ["approved_not_activated", "trial_active"]
    : ["approved_not_activated"];
  const { data: applications, error: applicationError } = await supabase
    .from("business_applications")
    .select("id,claimed_by_user_id")
    .eq("business_id", businessId)
    .in("status", claimableStatuses)
    .limit(2);
  if (applicationError) throw applicationError;
  if (!Array.isArray(applications) || applications.length !== 1 || !applications[0]?.claimed_by_user_id) {
    throw new Error("APPROVED_APPLICATION_REQUIRED");
  }
  return applications[0].id as string;
}

async function approvedActivationGateEnabled(supabase: any): Promise<boolean> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "approved_activation_gate")
    .maybeSingle();
  if (error) throw error;
  return data?.enabled === true;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed." }, 405);
  }

  let reservationAdmin: any = null;
  let checkoutReservationId: string | null = null;
  let createdStripeSessionId: string | null = null;
  let stripeForCleanup: Stripe | null = null;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) return jsonResponse(req, { error: "Stripe is not configured." }, 500);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(req, { error: "Invalid JSON body." }, 400);
    }

    const businessId = safeGetString(body.business_id);
    if (!businessId || !isUuid(businessId)) {
      return jsonResponse(req, { error: "Missing or invalid business_id." }, 400);
    }

    const requestedSource = billingSource(body.source);
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    reservationAdmin = supabaseAdmin;

    const rawToken = safeGetString(body.billing_token);
    let userId: string | null = null;
    let adminRole: string | null = null;
    let source: BillingSource;
    if (rawToken) {
      const tokenOk = await useBillingToken(supabaseAdmin, businessId, rawToken);
      if (!tokenOk) return jsonResponse(req, { error: "Invalid or expired billing link." }, 403);
      // Emailed checkout links are always the "email" surface; the body cannot
      // pick a different one (F-005: a raw-token holder could previously send
      // source "admin"/"test" and skip the purchase-surface gate).
      source = "email";
    } else {
      const {
        data: { user },
        error: userError,
      } = await supabaseUser.auth.getUser();
      if (userError || !user) return jsonResponse(req, { error: "Unauthorized." }, 401);
      if (isRedeemerUser(user)) return forbiddenForRedeemerResponse(corsHeaders);
      userId = user.id;
      const authz = await userCanBillBusiness(supabaseAdmin, businessId, user.id, requestedSource);
      if (!authz.ok) return jsonResponse(req, { error: "Forbidden." }, 403);
      adminRole = authz.adminRole;
      // "admin" only with a verified active admin role; everything else is the
      // public website surface regardless of what the body claimed.
      source = requestedSource === "admin" && adminCanCreateCheckout(authz.adminRole) ? "admin" : "website";
    }

    const config = await loadRuntimeBillingConfig(supabaseAdmin as any);
    if (config.purchaseSurface !== "web_only" && source !== "admin") {
      return jsonResponse(req, { error: "Web billing conversion is not enabled." }, 403);
    }
    if (stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment !== "production") {
      return jsonResponse(req, { error: "Live Stripe mode is not enabled for this environment." }, 500);
    }
    if (!stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment === "production") {
      return jsonResponse(req, { error: "Production billing requires a live Stripe key." }, 500);
    }
    if (!(await approvedActivationGateEnabled(supabaseAdmin))) {
      return jsonResponse(req, {
        error: "Trial activation is not available yet.",
        error_code: "APPROVED_ACTIVATION_GATE_DISABLED",
      }, 503);
    }

    // Audit F-005: the price is resolved exclusively server-side (runtime
    // config for the active billing environment, then server env fallbacks).
    // The request body carries no price selection — there is exactly one
    // purchasable product; if a second plan ever ships, the client sends an
    // enum key the server maps, never a raw Stripe price id.
    const priceId = (config.billingEnvironment === "production"
        ? config.twoferBusinessMonthlyPriceIdLive
        : config.twoferBusinessMonthlyPriceIdTest) ??
      safeGetString(Deno.env.get("STRIPE_PRICE_ID_TWOFER_PRO_MONTHLY")) ??
      safeGetString(Deno.env.get("STRIPE_TWOFER_BUSINESS_PRICE_ID")) ??
      safeGetString(Deno.env.get("STRIPE_PRICE_ID"));
    if (!priceId) return jsonResponse(req, { error: "Billing price is not configured." }, 500);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    stripeForCleanup = stripe;
    const applicationId = await assertBusinessCanStartTrialCheckout(supabaseAdmin, businessId);
    const billingInput = await loadBillingInput(supabaseAdmin, businessId);
    const customerResult = await ensureStripeCustomerForBusiness({
      supabase: supabaseAdmin,
      stripe,
      input: billingInput,
      source: `${source}_checkout`,
      accessStatus: "approved_not_activated",
    });
    if (!customerResult.stripeCustomerId) {
      return jsonResponse(req, { error: "Unable to prepare Stripe customer." }, 500);
    }

    // No-card trial (Dan, 2026-07-06). First decide the automatic outcome: the
    // global app_runtime_config.require_card_for_trial switch grants a no-card
    // trial by default, but only for a storefront that has not already used one
    // (one-trial-per-physical-location, per findings/05-trial-reuse-guard.md).
    // Only if the card would otherwise be required do we fall back to a
    // single-use exemption code, which overrides BOTH the switch and the reuse
    // guard (a manual VIP override, like admin_grant_location_trial's
    // p_override_trial_reuse). Consuming the code last avoids burning a
    // limited-use code when no-card was already going to be granted anyway.
    let skipCardCollection = false;
    if (!config.requireCardForTrial) {
      const locationId = await ensurePrimaryBusinessLocationId(supabaseAdmin, businessId);
      skipCardCollection = !(locationId && (await isBusinessLocationTrialAlreadyUsed(supabaseAdmin, locationId)));
    }
    if (!skipCardCollection) {
      skipCardCollection = await consumeTrialNoCardExemptionCode(
        supabaseAdmin,
        safeGetString(body.trial_no_card_code),
      );
    }

    const siteUrl = (Deno.env.get("SITE_URL") ?? "https://www.twoferapp.com").replace(/\/$/, "");
    const successBaseUrl = safeWebUrl(body.success_url, `${siteUrl}/business/billing/success/`);
    const successUrl = successBaseUrl.includes("{CHECKOUT_SESSION_ID}")
      ? successBaseUrl
      : `${successBaseUrl}${successBaseUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = safeWebUrl(body.cancel_url, `${siteUrl}/business/billing/cancel/`);
    const locale = normalizeStripeCheckoutLocale(body.locale);
    const metadata = {
      business_id: businessId,
      application_id: applicationId,
      owner_user_id: billingInput.ownerUserId ?? "",
      billing_source: source,
      checkout_purpose: "trial_start",
      trial_days: String(STANDARD_TRIAL_DAYS),
      requested_by_user_id: userId ?? "",
      requested_by_admin_role: adminRole ?? "",
      environment: config.billingEnvironment,
    };

    const reservationExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const staleCutoff = new Date().toISOString();
    const { data: staleReservations, error: staleReservationReadError } = await supabaseAdmin
      .from("stripe_checkout_sessions")
      .select("id,stripe_checkout_session_id")
      .eq("business_id", businessId)
      .eq("session_type", "subscription_checkout")
      .in("status", ["created", "opened"])
      .eq("metadata->>checkout_purpose", "trial_start")
      .lt("url_expires_at", staleCutoff);
    if (staleReservationReadError) throw staleReservationReadError;

    for (const stale of staleReservations ?? []) {
      const staleStripeSessionId = safeGetString(stale.stripe_checkout_session_id);
      if (staleStripeSessionId) {
        const staleStripeSession = await stripe.checkout.sessions.retrieve(staleStripeSessionId);
        if (staleStripeSession.status === "complete") {
          throw new Error("TRIAL_CHECKOUT_COMPLETION_PENDING");
        }
        if (staleStripeSession.status === "open") {
          await stripe.checkout.sessions.expire(staleStripeSessionId);
        }
      }
      const { error: staleReservationUpdateError } = await supabaseAdmin
        .from("stripe_checkout_sessions")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", stale.id)
        .in("status", ["created", "opened"]);
      if (staleReservationUpdateError) throw staleReservationUpdateError;
    }

    checkoutReservationId = crypto.randomUUID();
    const { error: reservationError } = await supabaseAdmin.from("stripe_checkout_sessions").insert({
      id: checkoutReservationId,
      business_id: businessId,
      requested_by_user_id: userId,
      requested_by_admin_user_id: adminRole ? userId : null,
      stripe_customer_id: customerResult.stripeCustomerId,
      stripe_checkout_session_id: null,
      session_type: "subscription_checkout",
      mode: "subscription",
      price_id: priceId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      url_expires_at: reservationExpiresAt,
      status: "created",
      source,
      metadata,
    });
    if (reservationError) {
      if (reservationError.code !== "23505") throw reservationError;
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("stripe_checkout_sessions")
        .select("stripe_checkout_session_id,url_expires_at")
        .eq("business_id", businessId)
        .eq("session_type", "subscription_checkout")
        .in("status", ["created", "opened"])
        .eq("metadata->>checkout_purpose", "trial_start")
        .maybeSingle();
      if (existingError) throw existingError;
      const existingStripeId = safeGetString(existing?.stripe_checkout_session_id);
      if (existingStripeId) {
        const existingSession = await stripe.checkout.sessions.retrieve(existingStripeId);
        if (existingSession.url && existingSession.status === "open") {
          return jsonResponse(req, {
            checkout_url: existingSession.url,
            checkout_session_id: existingSession.id,
            reused: true,
          });
        }
      }
      throw new Error("TRIAL_CHECKOUT_ALREADY_OPEN");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerResult.stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: businessId,
      locale,
      allow_promotion_codes: true,
      payment_method_collection: skipCardCollection ? "if_required" : "always",
      automatic_tax: { enabled: config.automaticTaxEnabled || Deno.env.get("STRIPE_TAX_ENABLED") === "true" },
      metadata,
      subscription_data: {
        metadata,
        // Approval activation always starts with the promised 30-day Stripe
        // trial. Card collection changes payment_method_collection only.
        trial_period_days: STANDARD_TRIAL_DAYS,
      },
    });
    createdStripeSessionId = session.id;

    if (!session.url) {
      throw new Error("STRIPE_CHECKOUT_URL_MISSING");
    }

    const { error: insertError } = await supabaseAdmin.from("stripe_checkout_sessions").update({
      stripe_checkout_session_id: session.id,
      url_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", checkoutReservationId);
    if (insertError) throw insertError;

    await supabaseAdmin.from("billing_events").insert({
      business_id: businessId,
      stripe_customer_id: customerResult.stripeCustomerId,
      stripe_checkout_session_id: session.id,
      event_source: source === "admin" ? "admin" : "website",
      event_type: "stripe_checkout_session_created",
      status_after: "checkout_created",
      app_access_after: "approved_not_activated",
      processing_status: "processed",
      processed_at: new Date().toISOString(),
    });

    return jsonResponse(req, { checkout_url: session.url, checkout_session_id: session.id });
  } catch (err) {
    if (createdStripeSessionId && stripeForCleanup) {
      try {
        await stripeForCleanup.checkout.sessions.expire(createdStripeSessionId);
      } catch {
        // The webhook/session expiry reconciliation remains the final safety net.
      }
    }
    if (checkoutReservationId && reservationAdmin) {
      await reservationAdmin
        .from("stripe_checkout_sessions")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", checkoutReservationId)
        .in("status", ["created", "opened"]);
    }
    if (err instanceof Error && err.message === "BUSINESS_ALREADY_ACTIVATED") {
      return jsonResponse(req, { error: "This business has already activated billing." }, 409);
    }
    if (err instanceof Error && err.message === "BUSINESS_NOT_APPROVED_FOR_ACTIVATION") {
      return jsonResponse(req, { error: "This business is not approved for trial activation." }, 409);
    }
    if (err instanceof Error && err.message === "APPROVED_APPLICATION_REQUIRED") {
      return jsonResponse(req, { error: "A claimed approved application is required before activation." }, 409);
    }
    if (err instanceof Error && err.message === "TRIAL_CHECKOUT_ALREADY_OPEN") {
      return jsonResponse(req, { error: "An activation checkout is already open. Please retry shortly." }, 409);
    }
    if (err instanceof Error && err.message === "TRIAL_CHECKOUT_COMPLETION_PENDING") {
      return jsonResponse(req, { error: "Checkout confirmation is still pending. Please check activation status." }, 409);
    }
    console.error("[stripe-create-checkout-session] error:", err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { error: "Failed to create checkout session." }, 500);
  }
});
