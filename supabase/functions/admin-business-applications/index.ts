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
  billingProfileFromOnboarding,
  ensureStripeCustomerForBusiness,
} from "../_shared/stripe-business-billing.ts";

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
};

type DecisionKey = "approve_limited" | "approve_full" | "review_required" | "waitlist" | "reject";

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
};

type BusinessDecisionSyncResult = {
  businessUpdated: boolean;
  billingSyncWarning: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_STATUSES = ["pending_review", "pending_verification", "review_required"];

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
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

function decisionConfig(decision: DecisionKey): DecisionConfig {
  if (decision === "approve_limited") {
    return {
      status: "trial_limited",
      accessTier: "trial_limited",
      verificationStatus: "verified_low_risk",
      trialDays: 14,
      trialOfferLimit: 1,
      trialClaimLimit: 25,
      requestStatus: "trial_limited",
      businessStatus: "limited_trial",
      businessAccessLevel: "limited_trial",
      businessVerificationStatus: "basic_verified",
      subscriptionAccessStatus: "trial_limited",
      auditAction: "admin_business_application_approved_limited",
    };
  }
  if (decision === "approve_full") {
    return {
      status: "trial_active",
      accessTier: "trialing",
      verificationStatus: "verified_low_risk",
      trialDays: 30,
      trialOfferLimit: 3,
      trialClaimLimit: 50,
      requestStatus: "pending_verification",
      businessStatus: "trialing",
      businessAccessLevel: "full_trial",
      businessVerificationStatus: "manual_verified",
      subscriptionAccessStatus: "trialing",
      auditAction: "admin_business_application_approved_full",
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
  };
}

function isDecision(value: unknown): value is DecisionKey {
  return (
    value === "approve_limited" ||
    value === "approve_full" ||
    value === "review_required" ||
    value === "waitlist" ||
    value === "reject"
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
    query = query.in("status", ["trial_limited", "trial_active", "approved_not_billed", "active"]);
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
  ownerUserId: string | null,
): Promise<BusinessDecisionSyncResult> {
  if (!businessId) return { businessUpdated: false, billingSyncWarning: null };

  const approvedPatch = config.status === "trial_limited" || config.status === "trial_active"
    ? {
        first_approved_at: new Date().toISOString(),
        approved_by: ctx.user.id,
      }
    : {};

  const { error } = await ctx.supabaseAdmin
    .from("businesses")
    .update({
      status: config.businessStatus,
      access_level: config.businessAccessLevel,
      verification_status: config.businessVerificationStatus,
      risk_score: Number(application.risk_score) || null,
      risk_level: riskLevel(application.risk_score),
      ...approvedPatch,
    })
    .eq("id", businessId);
  if (error) throw error;

  if ((config.status === "trial_limited" || config.status === "trial_active") && ownerUserId) {
    try {
      await ensureStripeCustomerForBusiness({
        supabase: ctx.supabaseAdmin,
        stripe: null,
        input: billingProfileFromOnboarding({
          businessId,
          ownerUserId,
          normalized: normalizedFromApplication(application),
          source: "admin_review",
          sourceRecordId: String(application.id),
        }),
        source: "admin_review",
        trialDays: config.trialDays,
        accessStatus: config.subscriptionAccessStatus,
      });
    } catch (billingError) {
      console.error("[admin-business-applications] billing sync failed:", billingError);
      const billingWarning = "Billing sync needs follow-up, but the trial decision was saved.";
      try {
        await ctx.supabaseAdmin.from("admin_audit_log").insert({
          admin_user_id: ctx.user.id,
          admin_email: ctx.adminUser.email ?? ctx.user.email ?? null,
          action: "admin_business_application_billing_sync_failed",
          target_type: "business_application",
          target_id: String(application.id),
          business_id: businessId,
          reason: "billing_sync_failed_after_admin_decision",
          request_id: ctx.requestId,
        });
      } catch (auditError) {
        console.error("[admin-business-applications] billing sync audit failed:", auditError);
      }
      return { businessUpdated: true, billingSyncWarning: billingWarning };
    }
  }

  return { businessUpdated: true, billingSyncWarning: null };
}

async function applyDecision(
  req: Request,
  ctx: AdminContext,
  application: Record<string, unknown>,
  decision: DecisionKey,
  rawReason: unknown,
) {
  const applicationId = String(application.id);
  const config = decisionConfig(decision);
  const reason = cleanBusinessString(rawReason, 500) ?? "";
  const adminEmail = ctx.adminUser.email ?? ctx.user.email ?? null;
  const onboardingRequestId = await ensureOnboardingRequestForDecision(ctx, application, config);
  const { businessId, ownerUserId } = await maybeMaterializeBusiness(ctx, application, config);

  const applicationPatch = {
    status: config.status,
    access_tier: config.accessTier,
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

  const businessSync = await syncBusinessDecision(ctx, application, config, businessId, ownerUserId);

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
  });
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

  return applyDecision(req, ctx, applicationData as Record<string, unknown>, payload.decision, payload.reason);
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
  const accessDecision: DecisionKey = decision === "approve_full"
    ? "approve_full"
    : decision === "review_required"
    ? "review_required"
    : "approve_limited";

  if (!businessName || !contactName || !EMAIL_RE.test(email)) {
    return json(req, { error: "Business name, contact name, and a valid email are required." }, 400);
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
    const adminContext = await requireAdmin(req, requestId);
    if (adminContext instanceof Response) return adminContext;

    action = cleanString(payload.action || "list", 40);
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
      : action === "create"
      ? "Failed to create business trial."
      : action === "verify_business"
      ? "Failed to save verification decision."
      : "Failed to load trial requests.";
    return json(req, { error, request_id: requestId }, 500);
  }
});
