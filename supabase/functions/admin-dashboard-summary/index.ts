import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { isAal2 } from "../_shared/admin-mfa.ts";

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

const SECTION_NAMES = ["businesses", "offers", "billing_events", "audit_log", "settings", "business_detail"] as const;
type SectionName = (typeof SECTION_NAMES)[number];

function isSectionName(value: unknown): value is SectionName {
  return typeof value === "string" && (SECTION_NAMES as readonly string[]).includes(value);
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ownerEmailsForBusinesses(
  supabaseAdmin: any,
  businessIds: string[],
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  if (!businessIds.length) return emails;
  const { data, error } = await supabaseAdmin
    .from("business_applications")
    .select("business_id,email")
    .in("business_id", businessIds);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ business_id?: string; email?: string }>) {
    if (row.business_id && row.email && !emails.has(row.business_id)) {
      emails.set(row.business_id, row.email);
    }
  }
  return emails;
}

// Read-only per-tab data for the admin site. Every view is audited; mutations
// stay in their dedicated admin edge functions.
async function loadSection(
  supabaseAdmin: any,
  section: SectionName,
  payload: Record<string, unknown>,
  canViewAdminUsers: boolean,
): Promise<Record<string, unknown>> {
  if (section === "businesses") {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("id,name,status,access_level,verification_status,risk_level,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const emails = await ownerEmailsForBusinesses(
      supabaseAdmin,
      rows.map((row) => String(row.id)),
    );
    return {
      businesses: rows.map((row) => ({ ...row, owner_email: emails.get(String(row.id)) ?? null })),
    };
  }

  if (section === "offers") {
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select("id,title,business_id,is_active,start_time,end_time,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const businessIds = [...new Set(rows.map((row) => String(row.business_id)).filter(Boolean))];
    const names = new Map<string, string>();
    if (businessIds.length) {
      const { data: businesses, error: businessError } = await supabaseAdmin
        .from("businesses")
        .select("id,name")
        .in("id", businessIds);
      if (businessError) throw businessError;
      for (const business of (businesses ?? []) as Array<{ id: string; name?: string }>) {
        names.set(business.id, business.name ?? business.id);
      }
    }
    return {
      offers: rows.map((row) => ({ ...row, business_name: names.get(String(row.business_id)) ?? null })),
    };
  }

  if (section === "billing_events") {
    const { data, error } = await supabaseAdmin
      .from("billing_provider_events")
      .select("id,provider,event_type,processing_status,received_at,processed_at,error_message")
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { billing_events: data ?? [] };
  }

  if (section === "audit_log") {
    const { data, error } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id,admin_email,action,target_type,business_id,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { audit_log: data ?? [] };
  }

  if (section === "settings") {
    const [launchAreas, featureFlags, adminUsers] = await Promise.all([
      supabaseAdmin
        .from("launch_areas")
        .select("id,name,slug,city,state,status,timezone")
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("feature_flags")
        .select("id,key,description,enabled,updated_at")
        .order("key", { ascending: true }),
      canViewAdminUsers
        ? supabaseAdmin
          .from("admin_users")
          .select("id,email,role,is_active,require_mfa,display_name,last_admin_login_at")
          .order("email", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (launchAreas.error) throw launchAreas.error;
    if (featureFlags.error) throw featureFlags.error;
    if (adminUsers.error) throw adminUsers.error;
    return {
      launch_areas: launchAreas.data ?? [],
      feature_flags: featureFlags.data ?? [],
      admin_users: adminUsers.data ?? [],
      admin_users_visible: canViewAdminUsers,
    };
  }

  // business_detail
  const businessId = typeof payload.business_id === "string" ? payload.business_id.trim() : "";
  if (!UUID_RE.test(businessId)) {
    return { business: null, applications: [], audit_log: [] };
  }
  const [business, applications, audit] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id,name,status,access_level,verification_status,risk_level,created_at")
      .eq("id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_applications")
      .select("id,business_name,contact_name,email,phone,address,business_type,launch_area,status,access_tier,verification_status,risk_score,trial_days,trial_offer_limit,trial_claim_limit,admin_notes,reviewed_at,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("admin_audit_log")
      .select("id,admin_email,action,target_type,reason,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (business.error) throw business.error;
  if (applications.error) throw applications.error;
  if (audit.error) throw audit.error;
  return {
    business: business.data ?? null,
    applications: applications.data ?? [],
    audit_log: audit.data ?? [],
  };
}

function utcMonthStart(offsetMonths = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1, 0, 0, 0, 0));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function usd(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(6)) : 0;
}

async function sumDailyAiCost(
  supabaseAdmin: any,
  startInclusive: Date,
  endExclusive: Date,
): Promise<{ totalUsd: number; attempts: number }> {
  const { data, error } = await supabaseAdmin
    .from("ai_generation_cost_daily")
    .select("total_ai_cost_usd,generated_ad_attempts")
    .gte("day", isoDate(startInclusive))
    .lt("day", isoDate(endExclusive));
  if (error) throw error;

  const rows = (data ?? []) as Array<{ total_ai_cost_usd?: unknown; generated_ad_attempts?: unknown }>;
  return rows.reduce(
    (acc, row) => ({
      totalUsd: usd(acc.totalUsd + usd(row.total_ai_cost_usd)),
      attempts: acc.attempts + (Number(row.generated_ad_attempts) || 0),
    }),
    { totalUsd: 0, attempts: 0 },
  );
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
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

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
    if (adminUser.require_mfa && !isAal2(bearerToken)) {
      return json(req, { error: "MFA verification required." }, 403);
    }

    const payload = req.method === "POST" ? await readPayload(req) : {};
    if (isSectionName(payload.section)) {
      const canViewAdminUsers = adminUser.role === "owner" || adminUser.role === "admin";
      const sectionData = await loadSection(supabaseAdmin, payload.section, payload, canViewAdminUsers);
      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: adminUser.email ?? user.email ?? null,
        action: `admin_${payload.section}_viewed`,
        target_type: "admin_dashboard",
        target_id: payload.section === "business_detail" && typeof payload.business_id === "string" &&
            UUID_RE.test(payload.business_id)
          ? payload.business_id
          : null,
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
        section: payload.section,
        ...sectionData,
      });
    }

    const nowIso = new Date().toISOString();
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    const sevenDaysOut = new Date();
    sevenDaysOut.setUTCDate(sevenDaysOut.getUTCDate() + 7);
    const currentMonthStart = utcMonthStart(0);
    const nextMonthStart = utcMonthStart(1);
    const priorMonthStart = utcMonthStart(-1);

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
      currentMonthAiSpend,
      priorMonthAiSpend,
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
      sumDailyAiCost(supabaseAdmin, currentMonthStart, nextMonthStart),
      sumDailyAiCost(supabaseAdmin, priorMonthStart, currentMonthStart),
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
        apiSpend: {
          currentMonthUsd: currentMonthAiSpend.totalUsd,
          currentMonthAttempts: currentMonthAiSpend.attempts,
          currentMonthStart: currentMonthStart.toISOString(),
          priorMonthUsd: priorMonthAiSpend.totalUsd,
          priorMonthAttempts: priorMonthAiSpend.attempts,
          priorMonthStart: priorMonthStart.toISOString(),
          priorMonthEnd: currentMonthStart.toISOString(),
          updatedAt: nowIso,
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
