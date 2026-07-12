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

type BillingSource = "admin" | "website" | "email" | "test";

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function billingSource(value: unknown): BillingSource {
  const source = safeGetString(value);
  return source === "admin" || source === "website" || source === "email" || source === "test"
    ? source
    : "website";
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

async function useBillingToken(supabase: any, businessId: string, rawToken: string | null): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await supabase
    .from("billing_tokens")
    .select("id,max_uses,use_count,expires_at,revoked_at,action")
    .eq("business_id", businessId)
    .eq("token_hash", tokenHash)
    .eq("action", "subscription_checkout")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || data.revoked_at) return false;
  if (new Date(String(data.expires_at)).getTime() <= Date.now()) return false;
  if (Number(data.use_count ?? 0) >= Number(data.max_uses ?? 1)) return false;
  const { error: updateError } = await supabase
    .from("billing_tokens")
    .update({ use_count: Number(data.use_count ?? 0) + 1 })
    .eq("id", data.id);
  if (updateError) throw updateError;
  return true;
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

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed." }, 405);
  }

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

    const source = billingSource(body.source);
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const rawToken = safeGetString(body.billing_token);
    let userId: string | null = null;
    let adminRole: string | null = null;
    if (rawToken) {
      const tokenOk = await useBillingToken(supabaseAdmin, businessId, rawToken);
      if (!tokenOk) return jsonResponse(req, { error: "Invalid or expired billing link." }, 403);
    } else {
      const {
        data: { user },
        error: userError,
      } = await supabaseUser.auth.getUser();
      if (userError || !user) return jsonResponse(req, { error: "Unauthorized." }, 401);
      if (isRedeemerUser(user)) return forbiddenForRedeemerResponse(corsHeaders);
      userId = user.id;
      const authz = await userCanBillBusiness(supabaseAdmin, businessId, user.id, source);
      if (!authz.ok) return jsonResponse(req, { error: "Forbidden." }, 403);
      adminRole = authz.adminRole;
    }

    const config = await loadRuntimeBillingConfig(supabaseAdmin as any);
    if (config.purchaseSurface !== "web_only" && source !== "admin" && source !== "test") {
      return jsonResponse(req, { error: "Web billing conversion is not enabled." }, 403);
    }
    if (stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment !== "production") {
      return jsonResponse(req, { error: "Live Stripe mode is not enabled for this environment." }, 500);
    }

    const priceId = safeGetString(body.price_id) ??
      (config.billingEnvironment === "production"
        ? config.twoferBusinessMonthlyPriceIdLive
        : config.twoferBusinessMonthlyPriceIdTest) ??
      safeGetString(Deno.env.get("STRIPE_PRICE_ID_TWOFER_PRO_MONTHLY")) ??
      safeGetString(Deno.env.get("STRIPE_PRICE_ID_TWOFer_PRO_MONTHLY")) ??
      safeGetString(Deno.env.get("STRIPE_TWOFER_BUSINESS_PRICE_ID")) ??
      safeGetString(Deno.env.get("STRIPE_PRICE_ID"));
    if (!priceId) return jsonResponse(req, { error: "Billing price is not configured." }, 500);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const billingInput = await loadBillingInput(supabaseAdmin, businessId);
    const customerResult = await ensureStripeCustomerForBusiness({
      supabase: supabaseAdmin,
      stripe,
      input: billingInput,
      source: `${source}_checkout`,
      accessStatus: "pending",
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
    const successUrl = safeWebUrl(body.success_url, `${siteUrl}/business/billing/success/`);
    const cancelUrl = safeWebUrl(body.cancel_url, `${siteUrl}/business/billing/cancel/`);
    const locale = normalizeStripeCheckoutLocale(body.locale);
    const metadata = {
      business_id: businessId,
      owner_user_id: billingInput.ownerUserId ?? "",
      billing_source: source,
      checkout_purpose: skipCardCollection ? "trial_start" : "paid_conversion",
      requested_by_user_id: userId ?? "",
      requested_by_admin_role: adminRole ?? "",
      environment: config.billingEnvironment,
    };

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
        // Guarantees $0 due today so Stripe actually skips card collection
        // under payment_method_collection "if_required" -- without an
        // explicit trial there is nothing to defer and a card is required
        // regardless of the setting above.
        ...(skipCardCollection ? { trial_period_days: config.noCardTrialDays } : {}),
      },
    });

    if (!session.url) {
      return jsonResponse(req, { error: "Stripe did not return a checkout session URL." }, 500);
    }

    const { error: insertError } = await supabaseAdmin.from("stripe_checkout_sessions").insert({
      business_id: businessId,
      requested_by_user_id: userId,
      requested_by_admin_user_id: adminRole ? userId : null,
      stripe_customer_id: customerResult.stripeCustomerId,
      stripe_checkout_session_id: session.id,
      session_type: "subscription_checkout",
      mode: "subscription",
      price_id: priceId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      url_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      status: "created",
      source,
      metadata,
    });
    if (insertError) throw insertError;

    await supabaseAdmin.from("billing_events").insert({
      business_id: businessId,
      stripe_customer_id: customerResult.stripeCustomerId,
      stripe_checkout_session_id: session.id,
      event_source: source === "admin" ? "admin" : "website",
      event_type: "stripe_checkout_session_created",
      status_after: "checkout_created",
      app_access_after: "pending",
      processing_status: "processed",
      processed_at: new Date().toISOString(),
    });

    return jsonResponse(req, { checkout_url: session.url, checkout_session_id: session.id });
  } catch (err) {
    console.error("[stripe-create-checkout-session] error:", err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { error: "Failed to create checkout session." }, 500);
  }
});
