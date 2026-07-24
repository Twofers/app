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

type PortalSource = "admin" | "merchant_web" | "email";

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  const corsHeaders = getCorsHeaders(req);
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function portalSource(value: unknown): PortalSource {
  const source = safeGetString(value);
  return source === "admin" || source === "merchant_web" || source === "email" ? source : "merchant_web";
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function adminCanOpenPortal(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "finance" || role === "support";
}

async function userCanOpenPortal(supabase: any, businessId: string, userId: string, source: PortalSource): Promise<{
  ok: boolean;
  adminRole: string | null;
}> {
  const adminRole = await activeAdminRole(supabase, userId);
  if (source === "admin") return { ok: adminCanOpenPortal(adminRole), adminRole };
  if (adminRole && adminCanOpenPortal(adminRole)) return { ok: true, adminRole };

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
 * replays of a single-use token cannot each create a portal session. Fails
 * closed on any RPC error.
 */
async function useBillingToken(supabase: any, businessId: string, rawToken: string | null): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await supabase.rpc("consume_billing_token", {
    p_business_id: businessId,
    p_token_hash: tokenHash,
    p_action: "customer_portal",
  });
  if (error) {
    // Code + message only — never the raw error object, which can echo RPC
    // arguments (token hash, business id) into platform logs.
    console.error("[stripe-customer-portal-session] billing_tokens consume failed:", error.code ?? "", error.message ?? "");
    return false;
  }
  return data === true;
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

    const requestedSource = portalSource(body.source);
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let userId: string | null = null;
    let adminRole: string | null = null;
    let source: PortalSource;
    const rawToken = safeGetString(body.billing_token);
    if (rawToken) {
      const tokenOk = await useBillingToken(supabaseAdmin, businessId, rawToken);
      if (!tokenOk) return jsonResponse(req, { error: "Invalid or expired billing link." }, 403);
      // Emailed portal links are always the "email" surface; the body cannot
      // relabel a token session as "admin" in the audit records.
      source = "email";
    } else {
      const {
        data: { user },
        error: userError,
      } = await supabaseUser.auth.getUser();
      if (userError || !user) return jsonResponse(req, { error: "Unauthorized." }, 401);
      if (isRedeemerUser(user)) return forbiddenForRedeemerResponse(corsHeaders);
      userId = user.id;
      const authz = await userCanOpenPortal(supabaseAdmin, businessId, user.id, requestedSource);
      if (!authz.ok) return jsonResponse(req, { error: "Forbidden." }, 403);
      adminRole = authz.adminRole;
      // "admin" only with a verified active admin role; every other
      // authenticated caller is the merchant web surface — the body cannot
      // relabel a session as "email" (that is derived from the token branch).
      source = requestedSource === "admin" && adminCanOpenPortal(authz.adminRole) ? "admin" : "merchant_web";
    }

    const config = await loadRuntimeBillingConfig(supabaseAdmin as any);
    if (stripeSecretKey.startsWith("sk_live_") && config.billingEnvironment !== "production") {
      return jsonResponse(req, { error: "Live Stripe mode is not enabled for this environment." }, 500);
    }

    const { data: billingProfile, error: billingError } = await supabaseAdmin
      .from("business_billing_profiles")
      .select("stripe_customer_id")
      .eq("business_id", businessId)
      .maybeSingle();
    if (billingError) throw billingError;

    const stripeCustomerId = safeGetString(billingProfile?.stripe_customer_id);
    if (!stripeCustomerId) {
      return jsonResponse(req, { error: "Missing Stripe customer id for this business." }, 400);
    }

    const siteUrl = (Deno.env.get("SITE_URL") ?? "https://www.twoferapp.com").replace(/\/$/, "");
    const returnUrl = safeWebUrl(body.return_url, `${siteUrl}/business/billing/manage/`);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
      configuration: safeGetString(Deno.env.get("STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID")) ?? undefined,
    });

    await supabaseAdmin.from("stripe_portal_sessions").insert({
      business_id: businessId,
      stripe_customer_id: stripeCustomerId,
      stripe_portal_session_id: portalSession.id,
      requested_by_user_id: userId,
      requested_by_admin_user_id: adminRole ? userId : null,
      source,
      return_url: returnUrl,
    });

    await supabaseAdmin.from("billing_events").insert({
      business_id: businessId,
      stripe_customer_id: stripeCustomerId,
      event_source: source === "admin" ? "admin" : "website",
      event_type: "stripe_portal_session_created",
      status_after: "portal_created",
      processing_status: "processed",
      processed_at: new Date().toISOString(),
    });

    return jsonResponse(req, { url: portalSession.url });
  } catch (err) {
    console.error("[stripe-customer-portal-session] error:", err instanceof Error ? err.message : String(err));
    return jsonResponse(req, { error: "Failed to create portal session." }, 500);
  }
});
