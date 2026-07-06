import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  materializeBusinessForUser,
  type NormalizedBusinessOnboarding,
} from "../_shared/business-onboarding-sync.ts";
import {
  billingProfileFromOnboarding,
  enqueueStripeCustomerSync,
  seedBusinessSubscription,
  upsertBusinessBillingProfile,
} from "../_shared/stripe-business-billing.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function friendlyStatus(status: string | null | undefined, accessLevel: string | null | undefined): string {
  if (status === "suspended" || status === "disabled") {
    return "Publishing is paused for this business. Please contact Twofer support.";
  }
  if (status === "trial_expired" || status === "past_due") {
    return "Your business account needs attention. Please contact Twofer support to continue using business features.";
  }
  if (accessLevel === "limited_trial") {
    return "Your limited trial is active. You can publish one test offer with limited claims.";
  }
  if (status === "trialing" || accessLevel === "full_trial") {
    return "Your business trial is active. You can create and publish eligible offers.";
  }
  return "Your business profile is being reviewed. You can finish setup and preview an offer now. Publishing will unlock after verification.";
}

function normalizeFromRequest(row: Record<string, unknown>): NormalizedBusinessOnboarding {
  const normalized = row.normalized_payload;
  if (normalized && typeof normalized === "object") {
    return normalized as NormalizedBusinessOnboarding;
  }
  return {
    businessName: String(row.business_name ?? ""),
    contactName: String(row.owner_name ?? ""),
    email: String(row.owner_email ?? "").toLowerCase(),
    phone: typeof row.phone === "string" ? row.phone : null,
    address: typeof row.business_address === "string" ? row.business_address : null,
    businessType: typeof row.business_type === "string" ? row.business_type : null,
    websiteOrInstagram: typeof row.website_or_instagram === "string" ? row.website_or_instagram : null,
    slowHours: typeof row.best_slow_hours === "string" ? row.best_slow_hours : null,
    offerInterests: typeof row.promote_text === "string" ? row.promote_text : null,
    launchArea: null,
    termsAccepted: row.accepted_business_terms === true,
    privacyAcknowledged: row.accepted_privacy_policy === true,
  };
}

async function ensureLinkedBusiness(
  supabase: DbClient,
  userId: string,
  email: string,
): Promise<string | null> {
  const { data: directBusiness, error: directError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();
  if (directError) throw directError;
  const direct = directBusiness as { id?: string } | null;
  if (direct?.id) return direct.id;

  const { data: member, error: memberError } = await supabase
    .from("business_members")
    .select("business_id,id")
    .or(`user_id.eq.${userId},invited_email.eq.${email}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (memberError) throw memberError;
  const memberRow = member as { id: string; business_id: string } | null;
  if (memberRow?.business_id) {
    await supabase
      .from("business_members")
      .update({ user_id: userId, status: "active", role: "owner", linked_at: new Date().toISOString() })
      .eq("id", memberRow.id);
    await supabase.from("businesses").update({ owner_id: userId }).eq("id", memberRow.business_id);
    return memberRow.business_id;
  }

  const { data: request, error: requestError } = await supabase
    .from("business_onboarding_requests")
    .select("*")
    .eq("owner_email", email)
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (requestError) throw requestError;
  const requestRow = request as Record<string, unknown> | null;
  if (!requestRow) return null;

  let decision: {
    status?: string | null;
    access_tier?: string | null;
    verification_status?: string | null;
    risk_score?: number | null;
    trial_days?: number | null;
  } = {
    status: requestRow.status as string | null,
    risk_score: requestRow.risk_score as number | null,
  };
  if (requestRow.application_id) {
    const { data: application, error: applicationError } = await supabase
      .from("business_applications")
      .select("status,access_tier,verification_status,risk_score,trial_days")
      .eq("id", requestRow.application_id as string)
      .maybeSingle();
    if (applicationError) throw applicationError;
    if (application) {
      decision = {
        status: (application as Record<string, unknown>).status as string | null,
        access_tier: (application as Record<string, unknown>).access_tier as string | null,
        verification_status: (application as Record<string, unknown>).verification_status as string | null,
        risk_score: (application as Record<string, unknown>).risk_score as number | null,
        trial_days: (application as Record<string, unknown>).trial_days as number | null,
      };
    }
  }

  const materialized = await materializeBusinessForUser(supabase, {
    userId,
    requestId: requestRow.id as string,
    applicationId: (requestRow.application_id as string | null) ?? null,
    normalized: normalizeFromRequest(requestRow),
    decision,
    source: "app_login",
  });
  const normalized = normalizeFromRequest(requestRow);
  await upsertBusinessBillingProfile(
    supabase,
    billingProfileFromOnboarding({
      businessId: materialized.businessId,
      ownerUserId: userId,
      normalized,
      source: "app_login",
      sourceRecordId: requestRow.id as string,
    }),
  );
  await seedBusinessSubscription(supabase, {
    businessId: materialized.businessId,
    source: "app_login",
    // Trial length was decided at admin approval time (business_applications.trial_days);
    // read it here so the trial clock actually has an end date once the owner
    // finishes onboarding, instead of an eternal trial with no expiration.
    trialDays: typeof decision.trial_days === "number" ? decision.trial_days : null,
    accessStatus: decision.access_tier === "trialing" || decision.status === "trial_active"
      ? "trialing"
      : decision.access_tier === "trial_limited" || decision.status === "trial_limited"
        ? "trial_limited"
        : "pending",
  });
  await enqueueStripeCustomerSync(supabase, {
    businessId: materialized.businessId,
    onboardingRequestId: requestRow.id as string,
    businessApplicationId: (requestRow.application_id as string | null) ?? null,
    reason: "materialized_from_app_login",
    payload: {
      owner_email: normalized.email,
      source: "app_login",
    },
  });
  return materialized.businessId;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Business onboarding is not configured." }, 500);
    }

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

    const email = user.email?.trim().toLowerCase();
    if (!email) return json(req, { error: "Email is required." }, 400);

    const businessId = await ensureLinkedBusiness(supabaseAdmin, user.id, email);
    if (!businessId) {
      return json(req, {
        ok: true,
        business: null,
        locations: [],
        contact_channels: [],
        slow_hours: [],
        promotable_items: [],
        setup_checklist: [],
        field_sources: [],
        terms_acceptances: [],
        first_offer_draft: null,
        access_state: {
          can_edit_profile: true,
          can_create_offer_draft: false,
          can_publish_offer: false,
          reason_code: "no_business",
          friendly_status_message: "Set up your business profile to create offers.",
        },
      });
    }

    const [
      businessResult,
      contactsResult,
      slowHoursResult,
      promotableItemsResult,
      checklistResult,
      fieldSourcesResult,
      termsResult,
      publishResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("id,name,contact_name,business_email,public_email,phone,address,location,category,hours_text,short_description,latitude,longitude,logo_url,status,access_level,verification_status,current_profile_version,profile_completion_score,website_url,instagram_url")
        .eq("id", businessId)
        .single(),
      supabaseAdmin
        .from("business_contact_channels")
        .select("id,type,label,value,normalized_value,is_public,is_primary,verification_status,source,updated_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("business_slow_hours")
        .select("id,label,day_of_week,starts_at,ends_at,raw_text,confidence,source,confirmed_at,updated_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("business_promotable_items")
        .select("id,name,description,category,suggested_offer_type,suggested_discount_text,source_raw_text,source,is_active,needs_policy_review,policy_review_status,updated_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("business_setup_checklist")
        .select("id,item_key,label,status,is_required,completed_at,updated_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("business_profile_field_sources")
        .select("field_key,source,current_value,last_updated_at,requires_review,review_status")
        .eq("business_id", businessId)
        .order("field_key", { ascending: true }),
      supabaseAdmin
        .from("terms_acceptances")
        .select("document_type,document_version,accepted_at,source")
        .eq("business_id", businessId)
        .order("accepted_at", { ascending: false }),
      supabaseUser.rpc("can_business_publish", { p_business_id: businessId }),
    ]);

    if (businessResult.error) throw businessResult.error;
    if (contactsResult.error) throw contactsResult.error;
    if (slowHoursResult.error) throw slowHoursResult.error;
    if (promotableItemsResult.error) throw promotableItemsResult.error;
    if (checklistResult.error) throw checklistResult.error;
    if (fieldSourcesResult.error) throw fieldSourcesResult.error;
    if (termsResult.error) throw termsResult.error;

    const business = businessResult.data as Record<string, unknown>;
    const publish = (publishResult.data ?? {}) as { canPublish?: boolean; reason?: string; limits?: unknown };
    const firstItem = Array.isArray(promotableItemsResult.data) ? promotableItemsResult.data[0] : null;
    const firstSlowHours = Array.isArray(slowHoursResult.data) ? slowHoursResult.data[0] : null;

    await supabaseAdmin.from("system_events").insert({
      event_type: "business_onboarding_context_loaded",
      source: "mobile_app",
      message: "Business onboarding context loaded.",
      metadata: { business_id: businessId, actor_user_id: user.id },
    });

    return json(req, {
      ok: true,
      business,
      locations: [],
      contact_channels: contactsResult.data ?? [],
      slow_hours: slowHoursResult.data ?? [],
      promotable_items: promotableItemsResult.data ?? [],
      setup_checklist: checklistResult.data ?? [],
      field_sources: fieldSourcesResult.data ?? [],
      terms_acceptances: termsResult.data ?? [],
      first_offer_draft: firstItem
        ? {
            title: `2-for-1 ${(firstItem as { name?: string }).name ?? "offer"}`,
            item_name: (firstItem as { name?: string }).name ?? null,
            suggested_window: (firstSlowHours as { raw_text?: string } | null)?.raw_text ?? null,
            terms: "Redeem in store by QR code during the listed offer window. Review before publishing.",
            source: "website_signup",
          }
        : null,
      access_state: {
        can_edit_profile: true,
        can_create_offer_draft: true,
        can_publish_offer: publish.canPublish === true,
        reason_code: publish.reason ?? "pending_verification",
        limits: publish.limits ?? null,
        friendly_status_message: friendlyStatus(String(business.status ?? ""), String(business.access_level ?? "")),
      },
    });
  } catch (error) {
    console.error("[get-business-onboarding-context] error:", error);
    return json(req, { error: "Could not load business onboarding context." }, 500);
  }
});
