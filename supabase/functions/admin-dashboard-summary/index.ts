import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";

type AdminRole =
  | "owner"
  | "admin"
  | "support"
  | "sales"
  | "finance"
  | "moderator"
  | "developer"
  | "read_only";

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function hasReadableAdminRole(role: unknown): role is AdminRole {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "support" ||
    role === "sales" ||
    role === "finance" ||
    role === "moderator" ||
    role === "developer" ||
    role === "read_only"
  );
}

async function countRows(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  const requestId = crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Admin dashboard is not configured." }, 500);
    }

    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return json(req, { error: "Unauthorized." }, 401);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    const { data: adminUser, error: adminError } = await supabaseAdmin
      .from("admin_users")
      .select("id,email,role,is_active,require_mfa,display_name")
      .eq("id", user.id)
      .maybeSingle();

    if (adminError) throw adminError;
    if (!adminUser?.is_active || !hasReadableAdminRole(adminUser.role)) {
      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: user.email ?? null,
        action: "admin_dashboard_denied",
        target_type: "admin_dashboard",
        reason: "not_active_admin",
        request_id: requestId,
      });
      return json(req, { error: "Forbidden." }, 403);
    }

    const nowIso = new Date().toISOString();
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    const sevenDaysOut = new Date();
    sevenDaysOut.setUTCDate(sevenDaysOut.getUTCDate() + 7);

    const [
      activeBusinesses,
      pendingBusinesses,
      suspendedBusinesses,
      trialRequests,
      highRiskRequests,
      liveOffers,
      offersNeedingReview,
      claimsToday,
      redemptionsToday,
      trialingLocations,
      trialsEndingSoon,
      pastDueLocations,
      pastDueBusinesses,
      missingStripeCustomers,
      stripeWebhookErrors,
      failedAdminActions,
      newConsumersThisWeek,
    ] = await Promise.all([
      countRows(
        supabaseAdmin
          .from("businesses")
          .select("id", { count: "exact", head: true })
          .in("status", ["active", "trialing", "limited_trial"]),
      ),
      countRows(
        supabaseAdmin
          .from("businesses")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_verification"),
      ),
      countRows(
        supabaseAdmin
          .from("businesses")
          .select("id", { count: "exact", head: true })
          .in("status", ["suspended", "disabled"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_applications")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending_review", "pending_verification", "review_required"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_applications")
          .select("id", { count: "exact", head: true })
          .lte("risk_score", 39)
          .in("status", ["pending_review", "pending_verification", "review_required"]),
      ),
      countRows(
        supabaseAdmin
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .gt("end_time", nowIso),
      ),
      countRows(
        supabaseAdmin
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("is_active", false)
          .gt("end_time", nowIso),
      ),
      countRows(
        supabaseAdmin
          .from("deal_claims")
          .select("id", { count: "exact", head: true })
          .gte("created_at", dayStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("deal_claims")
          .select("id", { count: "exact", head: true })
          .not("redeemed_at", "is", null)
          .gte("redeemed_at", dayStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("location_entitlements")
          .select("id", { count: "exact", head: true })
          .in("status", ["trial_active", "admin_trial_active"]),
      ),
      countRows(
        supabaseAdmin
          .from("location_entitlements")
          .select("id", { count: "exact", head: true })
          .in("status", ["trial_active", "admin_trial_active"])
          .lte("trial_ends_at", sevenDaysOut.toISOString())
          .gte("trial_ends_at", nowIso),
      ),
      countRows(
        supabaseAdmin
          .from("location_entitlements")
          .select("id", { count: "exact", head: true })
          .in("status", ["payment_failed_suspended", "trial_expired_payment_failed_suspended"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_subscriptions")
          .select("id", { count: "exact", head: true })
          .in("app_access_status", ["past_due_grace", "blocked", "suspended", "canceled", "expired"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_billing_profiles")
          .select("id", { count: "exact", head: true })
          .is("stripe_customer_id", null),
      ),
      countRows(
        supabaseAdmin
          .from("billing_provider_events")
          .select("id", { count: "exact", head: true })
          .eq("processing_status", "failed"),
      ),
      countRows(
        supabaseAdmin
          .from("admin_audit_log")
          .select("id", { count: "exact", head: true })
          .ilike("action", "%failed%")
          .gte("created_at", weekStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("consumer_profiles")
          .select("user_id", { count: "exact", head: true })
          .gte("created_at", weekStart.toISOString()),
      ),
    ]);

    const { data: recentApplications, error: applicationsError } = await supabaseAdmin
      .from("business_applications")
      .select("id,business_name,contact_name,email,business_type,launch_area,status,access_tier,risk_score,created_at")
      .order("created_at", { ascending: false })
      .limit(8);
    if (applicationsError) throw applicationsError;

    const { data: recentAudit, error: auditError } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id,admin_email,action,target_type,business_id,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(8);
    if (auditError) throw auditError;

    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: adminUser.email ?? user.email ?? null,
      action: "admin_dashboard_summary_viewed",
      target_type: "admin_dashboard",
      request_id: requestId,
    });

    return json(req, {
      ok: true,
      request_id: requestId,
      admin: {
        email: adminUser.email,
        role: adminUser.role,
        display_name: adminUser.display_name,
        require_mfa: adminUser.require_mfa,
      },
      summary: {
        businesses: {
          active: activeBusinesses,
          pendingVerification: pendingBusinesses,
          suspended: suspendedBusinesses,
          trialingLocations,
          trialsEndingSoon,
        },
        trialRequests: {
          open: trialRequests,
          highRisk: highRiskRequests,
        },
        offers: {
          live: liveOffers,
          needsReview: offersNeedingReview,
        },
        activity: {
          claimsToday,
          redemptionsToday,
          newConsumersThisWeek,
        },
        billing: {
          pastDueLocations,
          pastDueBusinesses,
          missingStripeCustomers,
          stripeWebhookErrors,
        },
        security: {
          failedAdminActions,
        },
      },
      recentApplications: recentApplications ?? [],
      recentAudit: recentAudit ?? [],
    });
  } catch (err) {
    console.error("[admin-dashboard-summary] error:", err);
    return json(req, { error: "Failed to load admin dashboard summary.", request_id: requestId }, 500);
  }
});
