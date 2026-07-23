import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { isAal2 } from "../_shared/admin-mfa.ts";
import {
  cleanString as cleanBusinessString,
  createOnboardingRequest,
  type NormalizedBusinessOnboarding,
} from "../_shared/business-onboarding-sync.ts";
import {
  sendApprovalEmail,
  type ApprovalEmailDecision,
} from "../_shared/approval-email.ts";
import { hasPossibleDuplicate, quickApprovalTokenHash } from "../_shared/admin-quick-approval.ts";
import { applyBusinessBillingAccessState } from "../_shared/business-location-entitlement-sync.ts";
import { grantFullAccessTrial } from "../_shared/admin-full-access-grant.ts";

type AdminRole =
  | "owner"
  | "admin"
  | "support"
  | "sales"
  | "finance"
  | "moderator"
  | "developer"
  | "read_only";

type AdminContext = {
  user: { id: string; email?: string | null };
  adminUser: {
    email?: string | null;
    role: AdminRole;
  };
  supabaseAdmin: any;
  requestId: string;
};

type Payload = {
  action?: unknown;
  status?: unknown;
  application_id?: unknown;
  business_id?: unknown;
  decision?: unknown;
  reason?: unknown;
  token?: unknown;
  trial_days?: unknown;
};

// `approve_setup_verified` was named `approve_full` until 2026-07-23. It never
// granted full access — only approved_not_activated with manual verification —
// and the old name kept getting read as "this one turns everything on".
// `approve_full_access` is the decision that actually does that.
type DecisionKey =
  | "approve_setup"
  | "approve_limited"
  | "approve_setup_verified"
  | "approve_full_access"
  | "review_required"
  | "waitlist"
  | "reject"
  | "suspend";

// Admin-entered countdown for approve_full_access, matching the
// business_applications.trial_days check constraint.
const MIN_FULL_ACCESS_TRIAL_DAYS = 1;
const MAX_FULL_ACCESS_TRIAL_DAYS = 120;

type VerificationDecision = "verify" | "reject" | "needs_more_info";

type DecisionConfig = {
  status: string;
  accessTier: string;
  verificationStatus: string;
  trialDays: number | null;
  trialOfferLimit: number | null;
  trialClaimLimit: number | null;
  requestStatus: string;
  businessStatus: string;
  businessAccessLevel: string;
  businessVerificationStatus: string;
  subscriptionAccessStatus: string;
  auditAction: string;
  /**
   * Non-null only for approve_full_access: the countdown length for an
   * admin-granted trial that is live immediately, with no Checkout step.
   */
  fullAccessTrialDays: number | null;
};

type BusinessDecisionSyncResult = {
  businessUpdated: boolean;
  billingSyncWarning: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_STATUSES = ["pending_review", "pending_verification", "review_required"];
const KNOWN_ACTIONS = new Set(["list", "decide", "create", "verify_business", "quick_preview", "quick_confirm"]);
const QUICK_APPROVAL_ACTIONS = new Set(["quick_preview", "quick_confirm"]);
const QUICK_APPROVAL_TOKEN_RE = /^[A-Za-z0-9_-]{40,200}$/;
const QUICK_APPROVAL_PROCESSING_TIMEOUT_MS = 2 * 60 * 1000;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function cleanString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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

function canDecideApplications(role: AdminRole): boolean {
  return role === "owner" || role === "admin" || role === "moderator" || role === "developer";
}

function riskLevel(score: unknown): "low" | "medium" | "high" | "blocked" | null {
  const value = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(value)) return null;
  if (value < 0) return "blocked";
  if (value >= 70) return "low";
  if (value >= 40) return "medium";
  return "high";
}

function decisionConfig(decision: DecisionKey, fullAccessTrialDays: number | null = null): DecisionConfig {
  if (decision === "approve_setup" || decision === "approve_limited") {
    return {
      status: "approved_not_activated",
      accessTier: "approved_not_activated",
      verificationStatus: "verified_low_risk",
      trialDays: null,
      trialOfferLimit: null,
      trialClaimLimit: null,
      requestStatus: "approved_not_activated",
      businessStatus: "approved_not_activated",
      businessAccessLevel: "approved_not_activated",
      businessVerificationStatus: "basic_verified",
      subscriptionAccessStatus: "approved_not_activated",
      auditAction: "admin_business_application_approved_for_setup",
      fullAccessTrialDays: null,
    };
  }
  if (decision === "approve_setup_verified") {
    return {
      status: "approved_not_activated",
      accessTier: "approved_not_activated",
      verificationStatus: "verified_low_risk",
      trialDays: null,
      trialOfferLimit: null,
      trialClaimLimit: null,
      requestStatus: "approved_not_activated",
      businessStatus: "approved_not_activated",
      businessAccessLevel: "approved_not_activated",
      businessVerificationStatus: "manual_verified",
      subscriptionAccessStatus: "approved_not_activated",
      // Audit action keeps its pre-rename string so log queries and dashboards
      // spanning the rename still return one continuous series.
      auditAction: "admin_business_application_approved_for_setup_full",
      fullAccessTrialDays: null,
    };
  }
  if (decision === "approve_full_access") {
    // Comp / partner / pilot fast-track: access is live the moment the owner
    // claims, with no Checkout step, and runs out after the admin's day count.
    //
    // The APPLICATION deliberately stays approved_not_activated here.
    // claim_approved_business_application_for_user only matches applications in
    // that status (migration 20260817120000), so anything else would strand an
    // unclaimed grant. The grant itself rides on full_access_trial_days, and the
    // live state lands either immediately (business already exists, via
    // syncBusinessDecision) or at claim time.
    return {
      status: "approved_not_activated",
      accessTier: "approved_not_activated",
      verificationStatus: "verified_low_risk",
      trialDays: fullAccessTrialDays,
      trialOfferLimit: null,
      trialClaimLimit: null,
      requestStatus: "approved_not_activated",
      businessStatus: "trialing",
      businessAccessLevel: "full_trial",
      businessVerificationStatus: "manual_verified",
      subscriptionAccessStatus: "trialing",
      auditAction: "admin_business_application_approved_full_access_comp",
      fullAccessTrialDays,
    };
  }
  if (decision === "waitlist") {
    return {
      status: "waitlisted",
      accessTier: "waitlisted",
      verificationStatus: "waitlisted",
      trialDays: null,
      trialOfferLimit: null,
      trialClaimLimit: null,
      requestStatus: "waitlisted",
      businessStatus: "pending_verification",
      businessAccessLevel: "none",
      businessVerificationStatus: "needs_more_info",
      subscriptionAccessStatus: "pending",
      auditAction: "admin_business_application_waitlisted",
      fullAccessTrialDays: null,
    };
  }
  if (decision === "reject") {
    return {
      status: "rejected",
      accessTier: "rejected",
      verificationStatus: "rejected",
      trialDays: null,
      trialOfferLimit: null,
      trialClaimLimit: null,
      requestStatus: "rejected",
      businessStatus: "rejected",
      businessAccessLevel: "none",
      businessVerificationStatus: "failed",
      subscriptionAccessStatus: "pending",
      auditAction: "admin_business_application_rejected",
      fullAccessTrialDays: null,
    };
  }
  if (decision === "suspend") {
    return {
      status: "suspended",
      accessTier: "suspended",
      verificationStatus: "needs_review",
      trialDays: null,
      trialOfferLimit: null,
      trialClaimLimit: null,
      requestStatus: "suspended",
      businessStatus: "suspended",
      businessAccessLevel: "none",
      businessVerificationStatus: "needs_more_info",
      subscriptionAccessStatus: "suspended",
      auditAction: "admin_business_application_suspended",
      fullAccessTrialDays: null,
    };
  }
  return {
    status: "review_required",
    accessTier: "review_required",
    verificationStatus: "needs_review",
    trialDays: null,
    trialOfferLimit: 1,
    trialClaimLimit: 10,
    requestStatus: "pending_verification",
    businessStatus: "pending_verification",
    businessAccessLevel: "pending",
    businessVerificationStatus: "needs_more_info",
    subscriptionAccessStatus: "pending",
    auditAction: "admin_business_application_review_required",
    fullAccessTrialDays: null,
  };
}

function isDecision(value: unknown): value is DecisionKey {
  return (
    value === "approve_limited" ||
    value === "approve_setup_verified" ||
    value === "approve_full_access" ||
    value === "approve_setup" ||
    value === "review_required" ||
    value === "waitlist" ||
    value === "reject" ||
    value === "suspend"
  );
}

/**
 * Every decision that approves the business — the activation gate, the
 * protected-access guard, the approved-email stamp, and the welcome email all
 * key off this, so a new approve_* decision must be added here too.
 */
function isApprovalDecision(
  decision: DecisionKey,
): decision is ApprovalEmailDecision {
  return (
    decision === "approve_setup" ||
    decision === "approve_limited" ||
    decision === "approve_setup_verified" ||
    decision === "approve_full_access"
  );
}

/**
 * Handing out working access with no payment is a narrower authority than
 * ordinary approval, so moderators and developers cannot do it.
 */
function canGrantFullAccess(role: AdminRole): boolean {
  return role === "owner" || role === "admin";
}

/** Admin-entered countdown; returns null when absent or out of range. */
function parseFullAccessTrialDays(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < MIN_FULL_ACCESS_TRIAL_DAYS || n > MAX_FULL_ACCESS_TRIAL_DAYS) return null;
  return n;
}

async function approvedActivationGateEnabled(supabaseAdmin: any): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("feature_flags")
    .select("enabled")
    .eq("key", "approved_activation_gate")
    .maybeSingle();
  if (error) throw error;
  return data?.enabled === true;
}

const PROTECTED_BUSINESS_ACCESS_LEVELS = new Set([
  "limited_trial",
  "full_trial",
  "paid",
  "admin_comped",
  "partner_comped",
  "internal_test",
]);

const PROTECTED_SUBSCRIPTION_ACCESS_STATUSES = new Set([
  "trial_limited",
  "trialing",
  "active",
  "past_due_grace",
  "comped",
]);

async function linkedBusinessHasProtectedAccess(
  supabaseAdmin: any,
  businessId: string,
): Promise<boolean> {
  const [
    { data: business, error: businessError },
    { data: subscription, error: subscriptionError },
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id,access_level")
      .eq("id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_subscriptions")
      .select("app_access_status,activated_at,stripe_subscription_id")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);
  if (businessError) throw businessError;
  if (subscriptionError) throw subscriptionError;
  if (!business) throw new Error("Linked business was not found.");

  return (
    PROTECTED_BUSINESS_ACCESS_LEVELS.has(String(business.access_level ?? "")) ||
    PROTECTED_SUBSCRIPTION_ACCESS_STATUSES.has(
      String(subscription?.app_access_status ?? ""),
    ) ||
    Boolean(subscription?.activated_at) ||
    Boolean(subscription?.stripe_subscription_id)
  );
}

async function readPayload(req: Request): Promise<Payload> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function requireAdmin(req: Request, requestId: string): Promise<AdminContext | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Admin business applications are not configured." }, 500);
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
    return forbiddenForRedeemerResponse(getCorsHeaders(req));
  }

  const { data: adminUser, error: adminError } = await supabaseAdmin
    .from("admin_users")
    .select("id,email,role,is_active,require_mfa")
    .eq("id", user.id)
    .maybeSingle();

  if (adminError) throw adminError;
  if (!adminUser?.is_active || !hasReadableAdminRole(adminUser.role)) {
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: user.email ?? null,
      action: "admin_business_applications_denied",
      target_type: "business_application",
      reason: "not_active_admin",
      request_id: requestId,
    });
    return json(req, { error: "Forbidden." }, 403);
  }
  if (adminUser.require_mfa && !isAal2(bearerToken)) {
    return json(req, { error: "MFA verification required." }, 403);
  }

  return {
    user: { id: user.id, email: user.email },
    adminUser: {
      email: adminUser.email,
      role: adminUser.role,
    },
    supabaseAdmin,
    requestId,
  };
}

function normalizedFromApplication(row: Record<string, unknown>): NormalizedBusinessOnboarding {
  return {
    businessName: String(row.business_name ?? ""),
    contactName: String(row.contact_name ?? ""),
    email: String(row.email ?? "").toLowerCase(),
    phone: typeof row.phone === "string" ? row.phone : null,
    address: typeof row.address === "string" ? row.address : null,
    businessType: typeof row.business_type === "string" ? row.business_type : null,
    websiteOrInstagram: typeof row.website_or_instagram === "string" ? row.website_or_instagram : null,
    slowHours: typeof row.slow_hours === "string" ? row.slow_hours : null,
    offerInterests: typeof row.offer_interests === "string" ? row.offer_interests : null,
    launchArea: typeof row.launch_area === "string" ? row.launch_area : null,
    termsAccepted: row.terms_accepted === true,
    privacyAcknowledged: row.privacy_acknowledged === true,
    // Carries the applicant's optional website selection through to the sync,
    // which writes a consent row only when this is true.
    promoMaterialsAuthorized: row.promo_materials_authorized === true,
  };
}

function appendAdminNote(existing: unknown, note: string, adminEmail: string | null | undefined): string | null {
  if (!note) return typeof existing === "string" ? existing : null;
  const stamp = new Date().toISOString();
  const prefix = adminEmail ? `${stamp} ${adminEmail}` : stamp;
  return [typeof existing === "string" ? existing.trim() : "", `[${prefix}] ${note}`]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
}

async function ensureOnboardingRequestForDecision(
  ctx: AdminContext,
  application: Record<string, unknown>,
  config: DecisionConfig,
): Promise<string | null> {
  const existingRequestId = typeof application.onboarding_request_id === "string"
    ? application.onboarding_request_id
    : null;
  if (existingRequestId) return existingRequestId;
  if (config.status === "rejected" || config.status === "waitlisted") return null;

  const normalized = normalizedFromApplication(application);
  const requestId = await createOnboardingRequest(
    ctx.supabaseAdmin,
    normalized,
    {
      source: application.source ?? "admin_review",
      business_application_id: application.id,
      business_name: normalized.businessName,
      contact_name: normalized.contactName,
      email: normalized.email,
      phone: normalized.phone,
      address: normalized.address,
      business_type: normalized.businessType,
      website_or_instagram: normalized.websiteOrInstagram,
      slow_hours: normalized.slowHours,
      offer_interests: normalized.offerInterests,
      launch_area: normalized.launchArea,
    },
    {
      applicationId: String(application.id),
      status: config.status,
      riskScore: Number(application.risk_score) || null,
      riskLevel: riskLevel(application.risk_score),
    },
  );
  await ctx.supabaseAdmin
    .from("business_applications")
    .update({ onboarding_request_id: requestId })
    .eq("id", application.id);
  return requestId;
}

async function listApplications(req: Request, ctx: AdminContext, payload: Payload) {
  const status = cleanString(payload.status, 40) || "open";
  let query = ctx.supabaseAdmin
    .from("business_applications")
    .select(
      "id,business_name,contact_name,email,phone,address,business_type,website_or_instagram,slow_hours,offer_interests,launch_area,status,access_tier,verification_status,risk_score,risk_reasons,trial_days,trial_offer_limit,trial_claim_limit,business_id,onboarding_request_id,admin_notes,reviewed_at,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (status === "open") {
    query = query.in("status", OPEN_STATUSES);
  } else if (status === "approved") {
    query = query.in("status", ["approved_not_activated", "trial_limited", "trial_active", "approved_not_billed", "active"]);
  } else if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;

  await ctx.supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: ctx.user.id,
    admin_email: ctx.adminUser.email ?? ctx.user.email ?? null,
    action: "admin_business_applications_listed",
    target_type: "business_application",
    reason: status,
    request_id: ctx.requestId,
  });

  return json(req, {
    ok: true,
    request_id: ctx.requestId,
    applications: data ?? [],
  });
}

async function maybeMaterializeBusiness(
  ctx: AdminContext,
  application: Record<string, unknown>,
  config: DecisionConfig,
): Promise<{ businessId: string | null; ownerUserId: string | null }> {
  const existingBusinessId = typeof application.business_id === "string" ? application.business_id : null;
  if (existingBusinessId) {
    const { data: business, error } = await ctx.supabaseAdmin
      .from("businesses")
      .select("id,owner_id")
      .eq("id", existingBusinessId)
      .maybeSingle();
    if (error) throw error;
    return {
      businessId: existingBusinessId,
      ownerUserId: typeof business?.owner_id === "string" ? business.owner_id : null,
    };
  }

  if (config.status === "rejected" || config.status === "waitlisted") {
    return { businessId: null, ownerUserId: null };
  }

  // Do not scan Supabase Auth by email in the admin decision request. That
  // makes approval latency depend on Auth user count and can exceed the
  // browser timeout. Unlinked approved requests materialize when the owner
  // signs in through get-business-onboarding-context.
  return { businessId: null, ownerUserId: null };
}

async function syncBusinessDecision(
  ctx: AdminContext,
  application: Record<string, unknown>,
  config: DecisionConfig,
  businessId: string | null,
): Promise<BusinessDecisionSyncResult> {
  if (!businessId) return { businessUpdated: false, billingSyncWarning: null };

  let existingBusiness: Record<string, unknown> | null = null;
  let existingSubscription: Record<string, unknown> | null = null;
  if (config.subscriptionAccessStatus === "approved_not_activated") {
    const [
      { data: business, error: businessReadError },
      { data, error: subscriptionReadError },
    ] = await Promise.all([
      ctx.supabaseAdmin
        .from("businesses")
        .select("access_level")
        .eq("id", businessId)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("business_subscriptions")
        .select("activated_at,app_access_status,stripe_subscription_id,trial_type,trial_start,trial_end,current_period_start,current_period_end,cancel_at_period_end")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);
    if (businessReadError) throw businessReadError;
    if (subscriptionReadError) throw subscriptionReadError;
    existingBusiness = business as Record<string, unknown> | null;
    existingSubscription = data as Record<string, unknown> | null;
  }
  const protectedLegacyAccess =
    PROTECTED_BUSINESS_ACCESS_LEVELS.has(String(existingBusiness?.access_level ?? "")) ||
    Boolean(existingSubscription?.activated_at) ||
    Boolean(existingSubscription?.stripe_subscription_id) ||
    PROTECTED_SUBSCRIPTION_ACCESS_STATUSES.has(
      String(existingSubscription?.app_access_status ?? ""),
    );

  const approvedPatch = config.status === "approved_not_activated" || config.status === "trial_limited" || config.status === "trial_active"
    ? {
        first_approved_at: new Date().toISOString(),
        approved_by: ctx.user.id,
      }
    : {};

  const { error } = await ctx.supabaseAdmin
    .from("businesses")
    .update({
      ...(protectedLegacyAccess ? {} : {
        status: config.businessStatus,
        access_level: config.businessAccessLevel,
      }),
      verification_status: config.businessVerificationStatus,
      risk_score: Number(application.risk_score) || null,
      risk_level: riskLevel(application.risk_score),
      ...approvedPatch,
    })
    .eq("id", businessId);
  if (error) throw error;

  if (config.subscriptionAccessStatus === "approved_not_activated") {
    if (!protectedLegacyAccess) {
      const { error: subscriptionUpdateError } = await ctx.supabaseAdmin
        .from("business_subscriptions")
        .upsert(
          {
            business_id: businessId,
            billing_mode: "web_stripe",
            billing_status: "none",
            app_access_status: "approved_not_activated",
            trial_type: null,
            trial_start: null,
            trial_end: null,
            current_period_start: null,
            current_period_end: null,
            cancel_at_period_end: false,
            source: "admin_approval_for_setup",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "business_id" },
        );
      if (subscriptionUpdateError) throw subscriptionUpdateError;
      await applyBusinessBillingAccessState({
        supabase: ctx.supabaseAdmin,
        businessId,
        provider: "admin",
        appAccessStatus: "approved_not_activated",
        trialType: null,
        trialStart: null,
        trialEnd: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
    }
  } else if (config.subscriptionAccessStatus === "trialing" && config.fullAccessTrialDays !== null) {
    // approve_full_access on a business that already exists: turn access on now
    // and start the countdown. No Stripe customer, subscription, or Checkout is
    // involved — expire-billing-access sweeps the row to `expired` once
    // trial_end passes, exactly as it does for any other card-free admin trial.
    // When the business does NOT exist yet, this is skipped and the marker
    // columns carry the grant to get-business-onboarding-context instead.
    await grantFullAccessTrial({
      supabase: ctx.supabaseAdmin,
      businessId,
      trialDays: config.fullAccessTrialDays,
      source: "admin_approval_full_access",
    });
  } else if (config.subscriptionAccessStatus === "suspended") {
    const now = new Date().toISOString();
    const { error: subscriptionError } = await ctx.supabaseAdmin
      .from("business_subscriptions")
      .update({
        app_access_status: "suspended",
        access_locked_at: now,
        access_locked_reason: "admin_suspension",
        updated_at: now,
      })
      .eq("business_id", businessId);
    if (subscriptionError) throw subscriptionError;
    await applyBusinessBillingAccessState({
      supabase: ctx.supabaseAdmin,
      businessId,
      provider: "admin",
      appAccessStatus: "suspended",
      trialType: null,
      trialStart: null,
      trialEnd: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  }

  return { businessUpdated: true, billingSyncWarning: null };
}

async function applyDecision(
  req: Request,
  ctx: AdminContext,
  application: Record<string, unknown>,
  decision: DecisionKey,
  rawReason: unknown,
  rawTrialDays: unknown = null,
) {
  const applicationId = String(application.id);
  if (isApprovalDecision(decision) && !(await approvedActivationGateEnabled(ctx.supabaseAdmin))) {
    return json(req, {
      error: "Approved activation rollout is not enabled.",
      error_code: "APPROVED_ACTIVATION_GATE_DISABLED",
    }, 503);
  }
  let fullAccessTrialDays: number | null = null;
  if (decision === "approve_full_access") {
    if (!canGrantFullAccess(ctx.adminUser.role)) {
      return json(req, {
        error: "This admin role cannot grant full access without payment.",
        error_code: "FULL_ACCESS_GRANT_FORBIDDEN",
      }, 403);
    }
    fullAccessTrialDays = parseFullAccessTrialDays(rawTrialDays);
    if (fullAccessTrialDays === null) {
      return json(req, {
        error: `Enter the number of trial days (${MIN_FULL_ACCESS_TRIAL_DAYS}-${MAX_FULL_ACCESS_TRIAL_DAYS}).`,
        error_code: "INVALID_TRIAL_DAYS",
      }, 400);
    }
  }
  const linkedBusinessId =
    typeof application.business_id === "string" ? application.business_id : null;
  if (
    isApprovalDecision(decision) &&
    linkedBusinessId &&
    await linkedBusinessHasProtectedAccess(ctx.supabaseAdmin, linkedBusinessId)
  ) {
    return json(req, {
      error: "Linked business already has protected access; use billing management instead.",
      error_code: "LINKED_BUSINESS_ACCESS_PROTECTED",
    }, 409);
  }
  const config = decisionConfig(decision, fullAccessTrialDays);
  const reason = cleanBusinessString(rawReason, 500) ?? "";
  const adminEmail = ctx.adminUser.email ?? ctx.user.email ?? null;
  const onboardingRequestId = await ensureOnboardingRequestForDecision(ctx, application, config);
  const { businessId } = await maybeMaterializeBusiness(ctx, application, config);

  const applicationPatch = {
    status: config.status,
    access_tier: config.accessTier,
    ...(isApprovalDecision(decision)
      ? { approved_email_normalized: String(application.email ?? "").trim().toLowerCase() }
      : {}),
    // Carries the grant to the claim path for an application whose business
    // does not exist yet; harmless (and cleared) on every other decision.
    full_access_trial_days: config.fullAccessTrialDays,
    full_access_granted_at: config.fullAccessTrialDays === null ? null : new Date().toISOString(),
    full_access_granted_by: config.fullAccessTrialDays === null ? null : ctx.user.id,
    verification_status: config.verificationStatus,
    trial_days: config.trialDays,
    trial_offer_limit: config.trialOfferLimit,
    trial_claim_limit: config.trialClaimLimit,
    reviewed_at: new Date().toISOString(),
    reviewed_by: ctx.user.id,
    business_id: businessId ?? application.business_id ?? null,
    onboarding_request_id: onboardingRequestId ?? application.onboarding_request_id ?? null,
    admin_notes: appendAdminNote(application.admin_notes, reason, adminEmail),
  };

  const { data: updated, error: updateError } = await ctx.supabaseAdmin
    .from("business_applications")
    .update(applicationPatch)
    .eq("id", applicationId)
    .select(
      "id,business_name,contact_name,email,phone,address,business_type,website_or_instagram,slow_hours,offer_interests,launch_area,status,access_tier,verification_status,risk_score,risk_reasons,trial_days,trial_offer_limit,trial_claim_limit,business_id,onboarding_request_id,admin_notes,reviewed_at,created_at,updated_at",
    )
    .single();
  if (updateError) throw updateError;

  if (onboardingRequestId) {
    await ctx.supabaseAdmin
      .from("business_onboarding_requests")
      .update({
        business_id: businessId ?? null,
        status: config.requestStatus,
        admin_review_status: decision,
        risk_score: Number(application.risk_score) || null,
        risk_level: riskLevel(application.risk_score),
        updated_at: new Date().toISOString(),
      })
      .eq("id", onboardingRequestId);
  }

  const businessSync = await syncBusinessDecision(ctx, application, config, businessId);

  // Approval email (best-effort; never blocks the decision). Approval no longer
  // starts access; it hands the owner to account setup and trial activation.
  let approvalEmailWarning: string | null = null;
  if (isApprovalDecision(decision)) {
    approvalEmailWarning = await sendApprovalEmail({
      supabaseAdmin: ctx.supabaseAdmin,
      application: updated as Record<string, unknown>,
      decision,
      requestId: ctx.requestId,
    });
  }

  await ctx.supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: ctx.user.id,
    admin_email: adminEmail,
    action: config.auditAction,
    target_type: "business_application",
    target_id: applicationId,
    business_id: businessId ?? null,
    before_value: {
      status: application.status,
      access_tier: application.access_tier,
      verification_status: application.verification_status,
      business_id: application.business_id ?? null,
    },
    after_value: {
      status: config.status,
      access_tier: config.accessTier,
      verification_status: config.verificationStatus,
      business_id: businessId ?? null,
    },
    reason: reason || decision,
    request_id: ctx.requestId,
  });

  return json(req, {
    ok: true,
    request_id: ctx.requestId,
    application: updated,
    business_linked: Boolean(businessId),
    business_updated: businessSync.businessUpdated,
    billing_sync_warning: businessSync.billingSyncWarning,
    approval_email_warning: approvalEmailWarning,
  });
}

type QuickApprovalContext = {
  rawTokenHash: string;
  application: Record<string, unknown>;
  adminUser: { id: string; email: string | null; role: AdminRole };
  supabaseAdmin: any;
};

function quickApprovalUnavailable(req: Request) {
  return json(req, {
    ok: false,
    error: "This quick-approval link is invalid, expired, already used, or no longer eligible.",
  }, 410);
}

function quickApprovalApplicationIsEligible(application: Record<string, unknown>): boolean {
  const riskScore = Number(application.risk_score);
  return application.status === "pending_review" &&
    application.access_tier === "pending_verification" &&
    application.verification_status === "verified_low_risk" &&
    application.terms_accepted === true &&
    application.privacy_acknowledged === true &&
    Number.isFinite(riskScore) &&
    riskScore >= 70;
}

async function loadQuickApprovalContext(
  req: Request,
  payload: Payload,
): Promise<QuickApprovalContext | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Quick approval is not configured." }, 500);
  }

  const rawToken = cleanString(payload.token, 240);
  if (!QUICK_APPROVAL_TOKEN_RE.test(rawToken)) return quickApprovalUnavailable(req);
  const tokenHash = await quickApprovalTokenHash(rawToken);
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const { data: applicationData, error: applicationError } = await supabaseAdmin
    .from("business_applications")
    .select("*")
    .eq("quick_approval_token_hash", tokenHash)
    .maybeSingle();
  if (applicationError) throw applicationError;
  const application = applicationData as Record<string, unknown> | null;
  if (!application || !quickApprovalApplicationIsEligible(application)) {
    return quickApprovalUnavailable(req);
  }

  const expiresAtMs = Date.parse(String(application.quick_approval_token_expires_at ?? ""));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || application.quick_approval_token_used_at) {
    return quickApprovalUnavailable(req);
  }

  const processingAtMs = Date.parse(String(application.quick_approval_processing_started_at ?? ""));
  const processingIsCurrent = application.quick_approval_processing_request_id &&
    Number.isFinite(processingAtMs) &&
    Date.now() - processingAtMs < QUICK_APPROVAL_PROCESSING_TIMEOUT_MS;
  if (processingIsCurrent) {
    return json(req, { ok: false, error: "This approval is already being processed. Please wait a moment." }, 409);
  }

  const issuedTo = typeof application.quick_approval_token_issued_to === "string"
    ? application.quick_approval_token_issued_to
    : "";
  if (!UUID_RE.test(issuedTo)) return quickApprovalUnavailable(req);
  const { data: adminData, error: adminError } = await supabaseAdmin
    .from("admin_users")
    .select("id,email,role,is_active")
    .eq("id", issuedTo)
    .maybeSingle();
  if (adminError) throw adminError;
  if (!adminData?.is_active || !hasReadableAdminRole(adminData.role) || !canDecideApplications(adminData.role)) {
    return quickApprovalUnavailable(req);
  }

  return {
    rawTokenHash: tokenHash,
    application,
    adminUser: {
      id: adminData.id,
      email: typeof adminData.email === "string" ? adminData.email : null,
      role: adminData.role,
    },
    supabaseAdmin,
  };
}

async function previewQuickApproval(req: Request, payload: Payload, requestId: string) {
  const context = await loadQuickApprovalContext(req, payload);
  if (context instanceof Response) return context;
  const application = context.application;

  // Audit the token-gated PII disclosure. Unlike every other read here, preview is
  // reachable without an admin session, so record who/when it was viewed — attributed
  // to the issued-to admin the token is bound to.
  await context.supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: context.adminUser.id,
    admin_email: context.adminUser.email,
    action: "admin_business_application_quick_previewed",
    target_type: "business_application",
    target_id: String(application.id),
    reason: "quick_approval_email_preview",
    request_id: requestId,
  });

  return json(req, {
    ok: true,
    application: {
      business_name: application.business_name,
      contact_name: application.contact_name,
      email: application.email,
      address: application.address,
      business_type: application.business_type,
      risk_score: application.risk_score,
    },
    approval: {
      trial_days: 30,
      offer_limit: null,
      claim_limit: null,
      expires_at: application.quick_approval_token_expires_at,
    },
  });
}

async function confirmQuickApproval(req: Request, payload: Payload, requestId: string) {
  const context = await loadQuickApprovalContext(req, payload);
  if (context instanceof Response) return context;
  const applicationId = String(context.application.id);
  const processingStartedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - QUICK_APPROVAL_PROCESSING_TIMEOUT_MS).toISOString();

  // Release only an abandoned processing claim. A fresh concurrent claim stays
  // intact and causes the guarded update below to return no row.
  await context.supabaseAdmin
    .from("business_applications")
    .update({
      quick_approval_processing_started_at: null,
      quick_approval_processing_request_id: null,
    })
    .eq("id", applicationId)
    .eq("quick_approval_token_hash", context.rawTokenHash)
    .is("quick_approval_token_used_at", null)
    .lt("quick_approval_processing_started_at", staleBefore);

  const { data: claimedData, error: claimError } = await context.supabaseAdmin
    .from("business_applications")
    .update({
      quick_approval_processing_started_at: processingStartedAt,
      quick_approval_processing_request_id: requestId,
    })
    .eq("id", applicationId)
    .eq("quick_approval_token_hash", context.rawTokenHash)
    .eq("status", "pending_review")
    .eq("access_tier", "pending_verification")
    .eq("verification_status", "verified_low_risk")
    .gte("risk_score", 70)
    .gt("quick_approval_token_expires_at", processingStartedAt)
    .is("quick_approval_token_used_at", null)
    .is("quick_approval_processing_request_id", null)
    .select("*")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimedData) {
    return json(req, { ok: false, error: "This approval is already being processed or is no longer available." }, 409);
  }

  let completed = false;
  try {
    // Re-run the duplicate screen on the freshly claimed row: a duplicate business
    // or a sibling application could have appeared between token mint and now. If
    // so, the finally block releases the claim and we fall back to manual review.
    if (
      await hasPossibleDuplicate(context.supabaseAdmin, {
        applicationId,
        ownerEmail: String(claimedData.email ?? ""),
        address: typeof claimedData.address === "string" ? claimedData.address : null,
        phone: typeof claimedData.phone === "string" ? claimedData.phone : null,
      })
    ) {
      return quickApprovalUnavailable(req);
    }

    const adminContext: AdminContext = {
      user: { id: context.adminUser.id, email: context.adminUser.email },
      adminUser: { email: context.adminUser.email, role: context.adminUser.role },
      supabaseAdmin: context.supabaseAdmin,
      requestId,
    };
    const decisionResponse = await applyDecision(
      req,
      adminContext,
      claimedData as Record<string, unknown>,
      "approve_setup",
      "Approved for setup; 30-day trial starts only after verified Stripe activation.",
    );
    const decisionPayload = await decisionResponse.json().catch(() => ({}));
    if (!decisionResponse.ok || !decisionPayload.ok) {
      throw new Error("quick_approval_decision_failed");
    }
    // The grant succeeded and is audited by applyDecision. From here the token MUST
    // NOT be treated as retryable, so mark completed BEFORE the single-use bookkeeping
    // below. That write is best-effort: if it errors, the approval still stands (status
    // is now approved_not_activated, so the eligibility guard blocks any re-grant) and we must
    // not fail the request or falsely release the link for a dead retry.
    completed = true;

    const usedAt = new Date().toISOString();
    const { error: completeError } = await context.supabaseAdmin
      .from("business_applications")
      .update({
        quick_approval_token_used_at: usedAt,
        quick_approval_token_used_by: context.adminUser.id,
        quick_approval_processing_started_at: null,
        quick_approval_processing_request_id: null,
      })
      .eq("id", applicationId)
      .eq("quick_approval_processing_request_id", requestId);
    if (completeError) {
      console.error(
        "[admin-business-applications] quick approval granted but single-use bookkeeping failed:",
        completeError,
      );
    }

    return json(req, {
      ok: true,
      request_id: requestId,
      business_name: claimedData.business_name,
      approval_email_warning: decisionPayload.approval_email_warning ?? null,
    });
  } finally {
    if (!completed) {
      // Release the processing claim so a genuine transient failure (or the
      // duplicate-guard decline above) frees the link. A completed grant never
      // reaches here, and the eligibility guard blocks any second grant anyway.
      await context.supabaseAdmin
        .from("business_applications")
        .update({
          quick_approval_processing_started_at: null,
          quick_approval_processing_request_id: null,
        })
        .eq("id", applicationId)
        .eq("quick_approval_processing_request_id", requestId);
    }
  }
}

async function decideApplication(req: Request, ctx: AdminContext, payload: Payload) {
  if (!canDecideApplications(ctx.adminUser.role)) {
    return json(req, { error: "This admin role cannot change trial requests." }, 403);
  }

  const applicationId = cleanString(payload.application_id, 80);
  if (!UUID_RE.test(applicationId) || !isDecision(payload.decision)) {
    return json(req, { error: "Application and decision are required." }, 400);
  }

  const { data: applicationData, error: applicationError } = await ctx.supabaseAdmin
    .from("business_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  if (applicationError) throw applicationError;
  if (!applicationData) return json(req, { error: "Trial request not found." }, 404);

  return applyDecision(
    req,
    ctx,
    applicationData as Record<string, unknown>,
    payload.decision,
    payload.reason,
    payload.trial_days,
  );
}

function isVerificationDecision(value: unknown): value is VerificationDecision {
  return value === "verify" || value === "reject" || value === "needs_more_info";
}

function verificationStatusFor(decision: VerificationDecision): string {
  return {
    verify: "manual_verified",
    reject: "failed",
    needs_more_info: "needs_more_info",
  }[decision];
}

// Manual verification independent of the trial-request pipeline: lets an admin
// flip a business's verification_status directly from the Businesses page,
// for businesses that already exist outside an open application decision.
async function verifyBusiness(req: Request, ctx: AdminContext, payload: Payload) {
  if (!canDecideApplications(ctx.adminUser.role)) {
    return json(req, { error: "This admin role cannot change business verification." }, 403);
  }

  const businessId = cleanString(payload.business_id, 80);
  if (!UUID_RE.test(businessId) || !isVerificationDecision(payload.decision)) {
    return json(req, { error: "Business and decision are required." }, 400);
  }

  const { data: business, error: businessError } = await ctx.supabaseAdmin
    .from("businesses")
    .select("id,verification_status")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  if (!business) return json(req, { error: "Business not found." }, 404);

  const nextStatus = verificationStatusFor(payload.decision);
  const reason = cleanBusinessString(payload.reason, 500) ?? "";
  const adminEmail = ctx.adminUser.email ?? ctx.user.email ?? null;

  const { data: updated, error: updateError } = await ctx.supabaseAdmin
    .from("businesses")
    .update({ verification_status: nextStatus })
    .eq("id", businessId)
    .select("id,verification_status")
    .single();
  if (updateError) throw updateError;

  await ctx.supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: ctx.user.id,
    admin_email: adminEmail,
    action: `admin_business_verification_${payload.decision}`,
    target_type: "business",
    target_id: businessId,
    business_id: businessId,
    before_value: { verification_status: business.verification_status },
    after_value: { verification_status: nextStatus },
    reason: reason || payload.decision,
    request_id: ctx.requestId,
  });

  return json(req, {
    ok: true,
    request_id: ctx.requestId,
    business: updated,
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Founder field invite: Dan signs a business up in person from /admin/businesses/new.
// Inserts a vetted application, then reuses the exact same audited decision pipeline
// (approval + owner-linkable onboarding request) as trial-request approval.
async function createApplication(req: Request, ctx: AdminContext, payload: Payload) {
  if (!canDecideApplications(ctx.adminUser.role)) {
    return json(req, { error: "This admin role cannot create business trials." }, 403);
  }

  const fields = (payload as Record<string, unknown>).fields;
  const input = (fields && typeof fields === "object" ? fields : {}) as Record<string, unknown>;
  const businessName = cleanString(input.business_name, 160);
  const contactName = cleanString(input.contact_name, 120);
  const email = cleanString(input.email, 200).toLowerCase();
  const decision = (payload as Record<string, unknown>).decision;
  const accessDecision: DecisionKey = decision === "approve_setup_verified"
    ? "approve_setup_verified"
    : decision === "review_required"
    ? "review_required"
    : "approve_limited";

  if (!businessName || !contactName || !EMAIL_RE.test(email)) {
    return json(req, { error: "Business name, contact name, and a valid email are required." }, 400);
  }
  if (isApprovalDecision(accessDecision) && !(await approvedActivationGateEnabled(ctx.supabaseAdmin))) {
    return json(req, {
      error: "Approved activation rollout is not enabled.",
      error_code: "APPROVED_ACTIVATION_GATE_DISABLED",
    }, 503);
  }

  const { data: application, error: insertError } = await ctx.supabaseAdmin
    .from("business_applications")
    .insert({
      business_name: businessName,
      contact_name: contactName,
      email,
      phone: cleanBusinessString(input.phone, 40),
      address: cleanBusinessString(input.address, 300),
      business_type: cleanBusinessString(input.business_type, 80),
      launch_area: cleanBusinessString(input.launch_area, 80) ?? "DFW",
      // The owner accepts terms in-app on first sign-in; an admin cannot accept for them.
      terms_accepted: false,
      privacy_acknowledged: false,
      source: "admin_field_invite",
      status: "pending_review",
      access_tier: "pending",
      verification_status: "pending",
      risk_score: 100,
      risk_reasons: ["admin_field_invite"],
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  await ctx.supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: ctx.user.id,
    admin_email: ctx.adminUser.email ?? ctx.user.email ?? null,
    action: "admin_business_application_created",
    target_type: "business_application",
    target_id: application.id,
    reason: cleanBusinessString(payload.reason, 500) ?? "admin_field_invite",
    request_id: ctx.requestId,
  });

  return applyDecision(req, ctx, application as Record<string, unknown>, accessDecision, payload.reason);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  const requestId = crypto.randomUUID();
  let action = "list";

  try {
    const payload = await readPayload(req);
    action = cleanString(payload.action || "list", 40);
    if (!KNOWN_ACTIONS.has(action)) {
      return json(req, { ok: false, error: "Unknown action.", request_id: requestId }, 400);
    }
    if (QUICK_APPROVAL_ACTIONS.has(action)) {
      return action === "quick_confirm"
        ? confirmQuickApproval(req, payload, requestId)
        : previewQuickApproval(req, payload, requestId);
    }

    const adminContext = await requireAdmin(req, requestId);
    if (adminContext instanceof Response) return adminContext;
    if (action === "decide") {
      return decideApplication(req, adminContext, payload);
    }
    if (action === "create") {
      return createApplication(req, adminContext, payload);
    }
    if (action === "verify_business") {
      return verifyBusiness(req, adminContext, payload);
    }
    return listApplications(req, adminContext, payload);
  } catch (err) {
    console.error("[admin-business-applications] error:", err);
    const error = action === "decide"
      ? "Failed to save trial decision."
      : action === "quick_confirm"
      ? "The quick approval could not be completed. Use the admin dashboard if this continues."
      : action === "quick_preview"
      ? "The quick-approval link could not be checked."
      : action === "create"
      ? "Failed to create business trial."
      : action === "verify_business"
      ? "Failed to save verification decision."
      : "Failed to load trial requests.";
    return json(req, { error, request_id: requestId }, 500);
  }
});
