import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import {
  cleanEmail,
  cleanString,
  createOnboardingRequest,
  normalizePhone,
  type NormalizedBusinessOnboarding,
} from "../_shared/business-onboarding-sync.ts";
import { enqueueStripeCustomerSync } from "../_shared/stripe-business-billing.ts";
import { adminAlertInbox, sendNewApplicationAdminAlert } from "../_shared/admin-alert-email.ts";
import { mintFullTrialQuickApproval } from "../_shared/admin-quick-approval.ts";

const RATE_LIMIT_WINDOW_MINUTES = 30;
const RATE_LIMIT_MAX_PER_EMAIL = 3;
const RATE_LIMIT_MAX_PER_IP = 8;

function firstForwardedIp(header: string | null): string | null {
  if (!header) return null;
  const first = header.split(",")[0]?.trim();
  return first || null;
}

async function isRateLimited(
  supabase: DbClient,
  params: { email: string; ip: string | null },
): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count: emailCount, error: emailError } = await supabase
    .from("business_onboarding_requests")
    .select("id", { count: "exact", head: true })
    .eq("owner_email", params.email)
    .gte("created_at", windowStart);
  if (emailError) throw emailError;
  if ((emailCount ?? 0) >= RATE_LIMIT_MAX_PER_EMAIL) return true;

  if (params.ip) {
    const { count: ipCount, error: ipError } = await supabase
      .from("business_onboarding_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", params.ip)
      .gte("created_at", windowStart);
    if (ipError) throw ipError;
    if ((ipCount ?? 0) >= RATE_LIMIT_MAX_PER_IP) return true;
  }

  return false;
}

type Payload = {
  business_name?: unknown;
  contact_name?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  business_type?: unknown;
  website_or_instagram?: unknown;
  slow_hours?: unknown;
  offer_interests?: unknown;
  launch_area?: unknown;
  terms_accepted?: unknown;
  privacy_acknowledged?: unknown;
  company_website?: unknown;
};

type DbClient = SupabaseClient<any, any, any, any, any>;

type IntakeDecision = {
  status: "pending_review" | "review_required" | "pending_verification" | "waitlisted" | "rejected";
  access_tier: "review_required" | "pending_verification" | "waitlisted" | "rejected";
  verification_status: "verified_low_risk" | "needs_review" | "in_progress" | "waitlisted" | "rejected";
  risk_score: number;
  risk_reasons: string[];
  trial_days: number | null;
  trial_offer_limit: number | null;
  trial_claim_limit: number | null;
};

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function includesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function isDfwLaunchArea(address: string | null, launchArea: string | null): boolean {
  const text = `${address ?? ""} ${launchArea ?? ""}`.toLowerCase();
  return includesAny(text, [
    "dfw",
    "dallas",
    "fort worth",
    "arlington",
    "plano",
    "frisco",
    "irving",
    "garland",
    "oak cliff",
    "bishop arts",
    "deep ellum",
    "richardson",
    "carrollton",
    "addison",
  ]);
}

function scoreApplication(args: {
  businessName: string;
  email: string;
  phone: string | null;
  address: string | null;
  businessType: string | null;
  websiteOrInstagram: string | null;
  offerInterests: string | null;
  launchArea: string | null;
}): IntakeDecision {
  let score = 15; // Valid email format from this public form is treated as basic email confidence.
  const riskReasons: string[] = ["email_format_valid"];

  if (args.phone) {
    score += 10;
    riskReasons.push("phone_provided");
  }

  const inLaunchArea = isDfwLaunchArea(args.address, args.launchArea);
  if (inLaunchArea) {
    score += 15;
    riskReasons.push("dfw_launch_area_match");
  } else {
    score -= 40;
    riskReasons.push("outside_or_unclear_launch_area");
  }

  if (args.address) {
    score += 10;
    riskReasons.push("address_provided");
  } else {
    score -= 30;
    riskReasons.push("missing_address");
  }

  if (args.websiteOrInstagram) {
    score += 15;
    riskReasons.push("website_or_social_provided");
  }

  if (args.businessType && includesAny(args.businessType, ["coffee", "cafe", "bakery"])) {
    score += 10;
    riskReasons.push("target_launch_category");
  }

  const policyText = `${args.businessName} ${args.businessType ?? ""} ${args.offerInterests ?? ""}`;
  if (
    includesAny(policyText, [
      "alcohol",
      "beer",
      "wine",
      "liquor",
      "tobacco",
      "nicotine",
      "vape",
      "cannabis",
      "marijuana",
      "drug",
      "weapon",
      "gun",
      "adult",
      "sexual",
      "prescription",
      "counterfeit",
    ])
  ) {
    return {
      status: "rejected",
      access_tier: "rejected",
      verification_status: "rejected",
      risk_score: -100,
      risk_reasons: [...riskReasons, "prohibited_category_or_offer_signal"],
      trial_days: null,
      trial_offer_limit: null,
      trial_claim_limit: null,
    };
  }

  const emailDomain = args.email.split("@")[1] ?? "";
  if (includesAny(emailDomain, ["mailinator.", "tempmail.", "10minutemail.", "guerrillamail."])) {
    score -= 25;
    riskReasons.push("disposable_email_domain");
  }

  if (!inLaunchArea) {
    return {
      status: "waitlisted",
      access_tier: "waitlisted",
      verification_status: "waitlisted",
      risk_score: score,
      risk_reasons: riskReasons,
      trial_days: null,
      trial_offer_limit: null,
      trial_claim_limit: null,
    };
  }

  if (score >= 70) {
    return {
      // Low risk is eligible for Dan's short-lived email approval, but the
      // public form itself never grants access. The existing audited decision
      // path changes this to the full 30-day trial only after explicit confirmation.
      status: "pending_review",
      access_tier: "pending_verification",
      verification_status: "verified_low_risk",
      risk_score: score,
      risk_reasons: riskReasons,
      trial_days: null,
      trial_offer_limit: null,
      trial_claim_limit: null,
    };
  }

  if (score >= 40) {
    return {
      status: "review_required",
      access_tier: "review_required",
      verification_status: "needs_review",
      risk_score: score,
      risk_reasons: riskReasons,
      trial_days: null,
      trial_offer_limit: 1,
      trial_claim_limit: 10,
    };
  }

  return {
    status: "pending_verification",
    access_tier: "pending_verification",
    verification_status: "in_progress",
    risk_score: score,
    risk_reasons: riskReasons,
    trial_days: null,
    trial_offer_limit: 1,
    trial_claim_limit: 10,
  };
}

function riskLevel(score: number): "low" | "medium" | "high" | "blocked" {
  if (score < 0) return "blocked";
  if (score >= 70) return "low";
  if (score >= 40) return "medium";
  return "high";
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }

  if (cleanString(payload.company_website, 120)) {
    return json(req, { ok: true });
  }

  const businessName = cleanString(payload.business_name, 120);
  const contactName = cleanString(payload.contact_name, 120);
  const email = cleanEmail(payload.email);
  const termsAccepted = payload.terms_accepted === true;
  const privacyAcknowledged = payload.privacy_acknowledged === true;

  if (!businessName || !contactName || !email || !termsAccepted || !privacyAcknowledged) {
    return json(req, { error: "Missing required fields." }, 400);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Business applications are not configured." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const requestIp = firstForwardedIp(req.headers.get("x-forwarded-for"));
    if (await isRateLimited(supabase, { email, ip: requestIp })) {
      return json(req, { error: "Too many requests. Please try again later." }, 429);
    }
    const phone = cleanString(payload.phone, 40);
    const address = cleanString(payload.address, 240);
    const businessType = cleanString(payload.business_type, 80);
    const websiteOrInstagram = cleanString(payload.website_or_instagram, 180);
    const slowHours = cleanString(payload.slow_hours, 500);
    const offerInterests = cleanString(payload.offer_interests, 500);
    const launchArea = cleanString(payload.launch_area, 120);
    const decision = scoreApplication({
      businessName,
      email,
      phone,
      address,
      businessType,
      websiteOrInstagram,
      offerInterests,
      launchArea,
    });
    const normalized: NormalizedBusinessOnboarding = {
      businessName,
      contactName,
      email,
      phone: normalizePhone(phone),
      address,
      businessType,
      websiteOrInstagram,
      slowHours,
      offerInterests,
      launchArea,
      termsAccepted,
      privacyAcknowledged,
    };
    const { data: application, error } = await supabase.from("business_applications").insert({
      business_name: businessName,
      contact_name: contactName,
      email,
      phone: normalized.phone,
      address,
      business_type: businessType,
      website_or_instagram: websiteOrInstagram,
      slow_hours: slowHours,
      offer_interests: offerInterests,
      launch_area: launchArea,
      terms_accepted: true,
      privacy_acknowledged: true,
      source: "website_start_trial",
      status: decision.status,
      access_tier: decision.access_tier,
      verification_status: decision.verification_status,
      risk_score: decision.risk_score,
      risk_reasons: decision.risk_reasons,
      trial_days: decision.trial_days,
      trial_offer_limit: decision.trial_offer_limit,
      trial_claim_limit: decision.trial_claim_limit,
    }).select("id").single();

    if (error) throw error;

    const quickApprovalUrl = await mintFullTrialQuickApproval(supabase, {
      applicationId: application.id as string,
      applicationStatus: decision.status,
      accessTier: decision.access_tier,
      verificationStatus: decision.verification_status,
      riskScore: decision.risk_score,
      adminEmail: adminAlertInbox(),
      ownerEmail: email,
      address,
      phone: normalized.phone,
    });

    // Best-effort admin alert (never throws, never blocks the insert): notify the
    // team a new application landed so a trial can be turned on. Fires for every
    // inserted application regardless of decision; the honeypot early-return and
    // rate-limited requests never reach this point. Only low-risk pending requests
    // receive a short-lived quick-approval action.
    await sendNewApplicationAdminAlert({
      applicationId: application.id as string,
      businessName,
      contactName,
      email,
      phone: normalized.phone,
      address,
      businessType,
      status: decision.status,
      accessTier: decision.access_tier,
      verificationStatus: decision.verification_status,
      riskScore: decision.risk_score,
      source: "website_start_trial",
    }, quickApprovalUrl);

    const requestId = await createOnboardingRequest(supabase, normalized, payload as Record<string, unknown>, {
      applicationId: application.id,
      status: decision.status,
      riskScore: decision.risk_score,
      riskLevel: riskLevel(decision.risk_score),
      ipAddress: requestIp,
      userAgent: req.headers.get("user-agent"),
    });

    // This is a public, unauthenticated endpoint: we never materialize a
    // business or create a Stripe customer for an existing account here,
    // since the submitter's control of `email` is unverified. Once the real
    // owner signs in to the app, get-business-onboarding-context re-reads
    // this onboarding request by their verified session email and
    // materializes the business then.
    await supabase.from("business_applications").update({ onboarding_request_id: requestId }).eq("id", application.id);
    await enqueueStripeCustomerSync(supabase, {
      onboardingRequestId: requestId,
      businessApplicationId: application.id,
      reason: "pending_owner_auth_user",
      payload: {
        owner_email: normalized.email,
        business_name: normalized.businessName,
        source: "website_signup",
      },
    });

    // Public endpoint: do not echo business_linked/customer state — it would
    // reveal whether an email already has a Twofer account.
    return json(req, { ok: true, onboarding_saved: true });
  } catch (err) {
    console.error("[submit-business-application] error:", err);
    return json(req, { error: "Could not submit business application." }, 500);
  }
});
