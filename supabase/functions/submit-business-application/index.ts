import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import {
  cleanEmail,
  cleanString,
  createOnboardingRequest,
  materializeBusinessForUser,
  normalizePhone,
  type NormalizedBusinessOnboarding,
} from "../_shared/business-onboarding-sync.ts";
import {
  billingProfileFromOnboarding,
  enqueueStripeCustomerSync,
  ensureStripeCustomerForBusiness,
} from "../_shared/stripe-business-billing.ts";

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
  status: "trial_limited" | "review_required" | "pending_verification" | "waitlisted" | "rejected";
  access_tier: "trial_limited" | "review_required" | "pending_verification" | "waitlisted" | "rejected";
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
      status: "trial_limited",
      access_tier: "trial_limited",
      verification_status: "verified_low_risk",
      risk_score: score,
      risk_reasons: riskReasons,
      trial_days: 14,
      trial_offer_limit: 1,
      trial_claim_limit: 25,
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

function billingAccessStatus(decision: IntakeDecision): string {
  if (decision.access_tier === "trial_limited") return "trial_limited";
  if (decision.status === "trial_limited") return "trial_limited";
  return "pending";
}

async function findExistingAuthUserIdByEmail(
  supabase: DbClient,
  email: string,
): Promise<string | null> {
  try {
    for (let page = 1; page <= 5; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const match = data.users.find((user) => user.email?.toLowerCase() === email);
      if (match) return match.id;
      if (data.users.length < 200) break;
    }
  } catch (error) {
    console.warn("[submit-business-application] auth user lookup skipped:", error);
  }
  return null;
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
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" }) : null;
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

    const requestId = await createOnboardingRequest(supabase, normalized, payload as Record<string, unknown>, {
      applicationId: application.id,
      status: decision.status,
      riskScore: decision.risk_score,
      riskLevel: riskLevel(decision.risk_score),
      ipAddress: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });

    const ownerUserId = await findExistingAuthUserIdByEmail(supabase, email);
    let businessId: string | null = null;
    if (ownerUserId && decision.status !== "rejected") {
      const materialized = await materializeBusinessForUser(supabase, {
        userId: ownerUserId,
        requestId,
        applicationId: application.id,
        normalized,
        decision,
        source: "website_signup",
      });
      businessId = materialized.businessId;
      await ensureStripeCustomerForBusiness({
        supabase,
        stripe,
        input: billingProfileFromOnboarding({
          businessId,
          ownerUserId,
          normalized,
          source: "website_signup",
          sourceRecordId: requestId,
        }),
        source: "website_signup",
        trialDays: decision.trial_days,
        accessStatus: billingAccessStatus(decision),
      });
    } else {
      await supabase.from("business_applications").update({ onboarding_request_id: requestId }).eq("id", application.id);
      await enqueueStripeCustomerSync(supabase, {
        onboardingRequestId: requestId,
        businessApplicationId: application.id,
        reason: ownerUserId ? "business_rejected_or_not_materialized" : "pending_owner_auth_user",
        payload: {
          owner_email: normalized.email,
          business_name: normalized.businessName,
          source: "website_signup",
        },
      });
    }

    return json(req, { ok: true, onboarding_saved: true, business_linked: Boolean(businessId), stripe_customer_ready: Boolean(businessId) });
  } catch (err) {
    console.error("[submit-business-application] error:", err);
    return json(req, { error: "Could not submit business application." }, 500);
  }
});
