import {
  audit,
  cleanEmail,
  cleanString,
  json,
  nullableString,
  readPayload,
  requireAdmin,
  UUID_RE,
} from "../_shared/admin-prospects.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  createOnboardingRequest,
  normalizePhone,
  type NormalizedBusinessOnboarding,
} from "../_shared/business-onboarding-sync.ts";
import { sendApprovalEmail } from "../_shared/approval-email.ts";

// Reviewed prospects become approved setup applications. The 30-day trial
// starts only after the owner activates through Stripe Checkout.
function decisionConfig(value: unknown) {
  const decision = cleanString(value, 40);
  if (decision === "approve_full") {
    return {
      applicationStatus: "approved_not_activated",
      accessTier: "approved_not_activated",
      verificationStatus: "verified_low_risk",
      trialDays: null,
      trialOfferLimit: null,
      trialClaimLimit: null,
      businessStatus: "approved_not_activated",
      businessAccessLevel: "approved_not_activated",
      businessVerificationStatus: "manual_verified",
      subscriptionAccessStatus: "approved_not_activated",
    };
  }
  return {
    applicationStatus: "approved_not_activated",
    accessTier: "approved_not_activated",
    verificationStatus: "verified_low_risk",
    trialDays: null,
    trialOfferLimit: null,
    trialClaimLimit: null,
    businessStatus: "approved_not_activated",
    businessAccessLevel: "approved_not_activated",
    businessVerificationStatus: "basic_verified",
    subscriptionAccessStatus: "approved_not_activated",
  };
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
  supabase: any,
  businessId: string,
): Promise<boolean> {
  const [
    { data: business, error: businessError },
    { data: subscription, error: subscriptionError },
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select("id,access_level")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_subscriptions")
      .select("app_access_status,activated_at,stripe_subscription_id")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  if (businessError) throw businessError;
  if (subscriptionError) throw subscriptionError;
  if (!business) {
    throw new Error("Linked business was not found.");
  }

  const protectedAccess =
    PROTECTED_BUSINESS_ACCESS_LEVELS.has(String(business.access_level ?? "")) ||
    PROTECTED_SUBSCRIPTION_ACCESS_STATUSES.has(
      String(subscription?.app_access_status ?? ""),
    ) ||
    Boolean(subscription?.activated_at) ||
    Boolean(subscription?.stripe_subscription_id);

  return protectedAccess;
}

function normalizedFromProspect(prospect: Record<string, unknown>, payload: Record<string, unknown>): NormalizedBusinessOnboarding {
  return {
    businessName: String(prospect.display_name ?? ""),
    contactName: cleanString(payload.contact_name, 120) || "Owner or manager",
    email: cleanEmail(payload.email),
    phone: normalizePhone(cleanString(payload.phone, 40)),
    address: cleanString(payload.address ?? prospect.address_line1, 240) || null,
    businessType: cleanString(payload.business_type ?? prospect.category, 80) || null,
    websiteOrInstagram: cleanString(payload.website_or_instagram, 180) || null,
    slowHours: cleanString(payload.slow_hours, 500) || null,
    offerInterests: cleanString(payload.offer_interests, 500) || "Interested in controlled local offers through Twofer.",
    launchArea: cleanString(payload.launch_area ?? prospect.city, 120) || null,
    termsAccepted: false,
    privacyAcknowledged: false,
  };
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

  try {
    const ctx = await requireAdmin(req, requestId, "trial.create");
    if (ctx instanceof Response) return ctx;
    if (!(await approvedActivationGateEnabled(ctx.supabaseAdmin))) {
      return json(req, {
        error: "Approved activation rollout is not enabled.",
        error_code: "APPROVED_ACTIVATION_GATE_DISABLED",
        request_id: requestId,
      }, 503);
    }
    const payload = await readPayload(req);
    const prospectId = cleanString(payload.prospect_id, 80);
    if (!UUID_RE.test(prospectId)) {
      return json(req, { error: "Prospect is required.", request_id: requestId }, 400);
    }

    const { data: prospect, error: prospectError } = await ctx.supabaseAdmin
      .from("business_prospects")
      .select("id,display_name,category,address_line1,city,state,postal_code,review_status,linked_business_id")
      .eq("id", prospectId)
      .maybeSingle();
    if (prospectError) throw prospectError;
    if (!prospect) return json(req, { error: "Prospect not found.", request_id: requestId }, 404);
    if (!["approved", "verified"].includes(String(prospect.review_status))) {
      return json(req, { error: "Review and approve the prospect before creating a trial.", request_id: requestId }, 409);
    }
    if (prospect.linked_business_id) {
      const protectedAccess = await linkedBusinessHasProtectedAccess(
        ctx.supabaseAdmin,
        String(prospect.linked_business_id),
      );
      if (protectedAccess) {
        return json(req, {
          error: "Linked business already has protected access; use billing management instead.",
          error_code: "LINKED_BUSINESS_ACCESS_PROTECTED",
          request_id: requestId,
        }, 409);
      }
    }

    const normalized = normalizedFromProspect(prospect as Record<string, unknown>, payload);
    if (!normalized.email) {
      return json(req, { error: "A valid owner email is required.", request_id: requestId }, 400);
    }
    const config = decisionConfig(payload.decision);
    const { data: application, error: applicationError } = await ctx.supabaseAdmin
      .from("business_applications")
      .insert({
        business_name: normalized.businessName,
        contact_name: normalized.contactName,
        email: normalized.email,
        approved_email_normalized: normalized.email.toLowerCase(),
        phone: normalized.phone,
        address: normalized.address,
        business_type: normalized.businessType,
        website_or_instagram: normalized.websiteOrInstagram,
        slow_hours: normalized.slowHours,
        offer_interests: normalized.offerInterests,
        launch_area: normalized.launchArea,
        terms_accepted: false,
        privacy_acknowledged: false,
        source: "prospect_admin_trial",
        status: config.applicationStatus,
        access_tier: config.accessTier,
        verification_status: config.verificationStatus,
        risk_score: 80,
        risk_reasons: ["reviewed_prospect_admin_trial"],
        trial_days: null,
        trial_offer_limit: config.trialOfferLimit,
        trial_claim_limit: config.trialClaimLimit,
        reviewed_at: new Date().toISOString(),
        reviewed_by: ctx.user.id,
        business_id: prospect.linked_business_id ?? null,
        admin_notes: nullableString(payload.reason, 1000),
      })
      .select("id,business_id,status,access_tier,trial_days,trial_offer_limit,trial_claim_limit")
      .single();
    if (applicationError) throw applicationError;

    const onboardingRequestId = await createOnboardingRequest(ctx.supabaseAdmin, normalized, {
      prospect_id: prospectId,
      source: "prospect_admin_trial",
    }, {
      applicationId: application.id,
      status: config.applicationStatus,
      riskScore: 80,
      riskLevel: "low",
    });

    await ctx.supabaseAdmin
      .from("business_applications")
      .update({ onboarding_request_id: onboardingRequestId })
      .eq("id", application.id);

    if (prospect.linked_business_id) {
      await ctx.supabaseAdmin.from("businesses").update({
        status: config.businessStatus,
        access_level: config.businessAccessLevel,
        verification_status: config.businessVerificationStatus,
        first_approved_at: new Date().toISOString(),
        approved_by: ctx.user.id,
      }).eq("id", prospect.linked_business_id);

      // Approval is setup-only. Billing profile, Stripe customer,
      // subscription, trial dates, credits, and access wait for the owner claim
      // and verified Checkout activation flow.
    }

    await ctx.supabaseAdmin.from("prospect_to_business_links").insert({
      prospect_id: prospectId,
      business_application_id: application.id,
      business_onboarding_request_id: onboardingRequestId,
      business_id: prospect.linked_business_id ?? null,
      conversion_type: "trial_created",
      created_by_admin_user_id: ctx.user.id,
    });
    await ctx.supabaseAdmin.from("business_prospects").update({
      status: "trial_created",
    }).eq("id", prospectId);
    await ctx.supabaseAdmin
      .from("sales_accounts")
      .update({ stage: "trial_created", next_action: "Owner must finish setup before any live offer" })
      .eq("prospect_id", prospectId);
    await ctx.supabaseAdmin.from("sales_activities").insert({
      prospect_id: prospectId,
      business_id: prospect.linked_business_id ?? null,
      activity_type: "trial_created",
      summary: "Admin created reviewed prospect trial application",
      created_by_admin_user_id: ctx.user.id,
    });

    await audit(ctx, {
      action: "admin_trial_created_from_prospect",
      targetType: "business_prospect",
      targetId: prospectId,
      businessId: prospect.linked_business_id ?? null,
      afterValue: {
        business_application_id: application.id,
        business_onboarding_request_id: onboardingRequestId,
        business_id: prospect.linked_business_id ?? null,
        trial_days: null,
      },
      reason: nullableString(payload.reason, 500) || "trial_created_from_prospect",
    });

    // Approval email (best-effort; never blocks the decision). Both tiers here
    // are setup approvals; the 30-day trial starts only after Checkout.
    const emailDecision = cleanString(payload.decision, 40) === "approve_full" ? "approve_full" : "approve_limited";
    const approvalEmailWarning = await sendApprovalEmail({
      supabaseAdmin: ctx.supabaseAdmin,
      application: {
        id: application.id,
        business_name: normalized.businessName,
        contact_name: normalized.contactName,
        email: normalized.email,
        trial_days: application.trial_days,
      },
      decision: emailDecision,
      requestId,
    });

    return json(req, {
      ok: true,
      request_id: requestId,
      application,
      business_onboarding_request_id: onboardingRequestId,
      approval_email_warning: approvalEmailWarning,
      note: "No deal or Stripe customer was created by this function.",
    });
  } catch (error) {
    console.error("[admin-trial-create-from-prospect] error:", error);
    return json(req, { error: "Failed to create trial from prospect.", request_id: requestId }, 500);
  }
});
