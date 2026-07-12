import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { safeGetString } from "../_shared/billing-runtime.ts";
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

function adminCanBackfill(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "finance" || role === "developer";
}

function billingInputFromRow(row: Record<string, unknown>): BusinessBillingProfileInput {
  return {
    businessId: String(row.id),
    ownerUserId: safeGetString(row.owner_id),
    billingName: safeGetString(row.name),
    billingEmail: safeGetString(row.business_email) ?? safeGetString(row.public_email),
    billingPhone: safeGetString(row.phone),
    billingAddressLine1: safeGetString(row.address),
    billingCountry: "US",
    billingContactName: safeGetString(row.contact_name),
    onboardingSource: "stripe_backfill",
    preferredPlan: "twofer_pro_monthly",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json(req, { error: "Stripe backfill is not configured." }, 500);

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
    if (!adminCanBackfill(adminRole)) return json(req, { error: "Forbidden." }, 403);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const dryRun = body.dry_run !== false;
    const limitValue = Number(body.limit ?? 25);
    const limit = Number.isFinite(limitValue) ? Math.min(Math.max(Math.trunc(limitValue), 1), 100) : 25;
    if (!dryRun && Deno.env.get("ENABLE_STRIPE_BACKFILL") !== "true") {
      return json(req, { error: "Stripe backfill writes are disabled." }, 403);
    }

    const { data: businesses, error: businessesError } = await supabaseAdmin
      .from("businesses")
      .select("id,owner_id,name,contact_name,business_email,public_email,phone,address,status")
      .not("status", "in", "(rejected,archived,disabled)")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (businessesError) throw businessesError;

    const rows = (businesses ?? []) as Record<string, unknown>[];
    const results: Array<Record<string, unknown>> = [];
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const stripe = !dryRun && stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" }) : null;

    for (const row of rows) {
      const businessId = String(row.id);
      const { data: billingProfile, error: billingError } = await supabaseAdmin
        .from("business_billing_profiles")
        .select("stripe_customer_id")
        .eq("business_id", businessId)
        .maybeSingle();
      if (billingError) throw billingError;
      if (safeGetString(billingProfile?.stripe_customer_id)) {
        results.push({ business_id: businessId, action: "skipped_existing_customer" });
        continue;
      }
      if (dryRun) {
        results.push({ business_id: businessId, action: "would_create_customer" });
        continue;
      }
      const result = await ensureStripeCustomerForBusiness({
        supabase: supabaseAdmin,
        stripe,
        input: billingInputFromRow(row),
        source: "stripe_backfill",
        accessStatus: "pending",
      });
      results.push({
        business_id: businessId,
        action: result.scheduled ? "scheduled" : result.reason,
        stripe_customer_id: result.stripeCustomerId,
      });
    }

    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: user.email ?? null,
      action: dryRun ? "stripe_customer_backfill_dry_run" : "stripe_customer_backfill_run",
      target_type: "billing",
      reason: `processed_${results.length}`,
    });

    return json(req, { ok: true, dry_run: dryRun, results });
  } catch (err) {
    console.error("[stripe-backfill-customers] error:", err instanceof Error ? err.message : String(err));
    return json(req, { error: "Could not run Stripe customer backfill." }, 500);
  }
});
