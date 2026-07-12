import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { isUuid, safeGetString } from "../_shared/billing-runtime.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  ensureStripeCustomerForBusiness,
  type BusinessBillingProfileInput,
} from "../_shared/stripe-business-billing.ts";

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
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

function adminCanSync(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "finance" || role === "developer";
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
    onboardingSource: safeGetString(billingProfile?.onboarding_source) ?? "admin_sync",
    preferredPlan: safeGetString(billingProfile?.preferred_plan) ?? "twofer_pro_monthly",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json(req, { error: "Stripe sync is not configured." }, 500);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body." }, 400);
    }

    const businessId = safeGetString(body.business_id);
    if (!businessId || !isUuid(businessId)) return json(req, { error: "Missing or invalid business_id." }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) return json(req, { error: "Unauthorized." }, 401);
    if (isRedeemerUser(user)) return forbiddenForRedeemerResponse(corsHeaders);

    const adminRole = await activeAdminRole(supabaseAdmin, user.id);
    if (!adminCanSync(adminRole)) return json(req, { error: "Forbidden." }, 403);

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" }) : null;
    const result = await ensureStripeCustomerForBusiness({
      supabase: supabaseAdmin,
      stripe,
      input: await loadBillingInput(supabaseAdmin, businessId),
      source: "admin_ensure_customer",
      accessStatus: safeGetString(body.access_status) ?? "pending",
    });

    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: user.email ?? null,
      action: "stripe_customer_ensured",
      target_type: "business",
      business_id: businessId,
      reason: result.scheduled ? "scheduled" : result.reason,
    });

    return json(req, { ok: true, stripe_customer_id: result.stripeCustomerId, scheduled: result.scheduled });
  } catch (err) {
    console.error("[stripe-ensure-customer] error:", err instanceof Error ? err.message : String(err));
    return json(req, { error: "Could not ensure Stripe customer." }, 500);
  }
});
