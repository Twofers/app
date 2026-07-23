import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";

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
  if (status === "approved_not_activated" || accessLevel === "approved_not_activated") {
    return "You're approved. Finish setup now; AI tools and publishing unlock after you activate your 30-day trial.";
  }
  return "Your business profile is being reviewed. You can finish setup and preview an offer now. Publishing will unlock after verification.";
}

/**
 * Claims the one approved application for this confirmed auth identity and
 * returns its inert or activated business. The database RPC owns all
 * idempotency, locking, matching, and materialization.
 */
async function ensureLinkedBusiness(
  supabase: DbClient,
  userId: string,
  email: string,
): Promise<string | null> {
  // The database RPC owns the complete claim/materialization transaction.
  // Never accept a pre-existing owner/member row before the confirmed auth
  // email has claimed exactly one approved application.
  const { data: atomicClaimData, error: atomicClaimError } = await supabase.rpc(
    "claim_approved_business_application_for_user",
    { p_user_id: userId, p_email: email },
  );
  if (atomicClaimError) throw atomicClaimError;
  const atomicClaim = (
    Array.isArray(atomicClaimData) ? atomicClaimData[0] : atomicClaimData
  ) as Record<string, unknown> | null;
  return typeof atomicClaim?.business_id === "string" ? atomicClaim.business_id : null;
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
    const confirmedAt = (user as { email_confirmed_at?: unknown; confirmed_at?: unknown }).email_confirmed_at ??
      (user as { confirmed_at?: unknown }).confirmed_at;
    if (typeof confirmedAt !== "string" || !confirmedAt) {
      return json(req, { error: "Please confirm your email before setting up a business." }, 403);
    }

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
          can_edit_profile: false,
          can_use_setup_tools: false,
          can_use_menu_tools: false,
          can_extract_initial_menu: false,
          can_create_text_draft: false,
          can_create_offer_draft: false,
          can_generate_ai: false,
          can_consume_offer_credits: false,
          can_publish_offer: false,
          can_receive_new_claims: false,
          can_redeem_existing_claims: false,
          can_manage_billing: false,
          reason_code: "approval_required",
          friendly_status_message: "Business setup opens after your application is approved.",
        },
      });
    }

    const [
      businessResult,
      locationsResult,
      contactsResult,
      slowHoursResult,
      promotableItemsResult,
      checklistResult,
      fieldSourcesResult,
      termsResult,
      capabilitiesResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("id,name,contact_name,business_email,public_email,phone,address,location,category,hours_text,short_description,latitude,longitude,logo_url,status,access_level,verification_status,current_profile_version,profile_completion_score,website_url,instagram_url")
        .eq("id", businessId)
        .single(),
      supabaseAdmin
        .from("business_locations")
        .select("id,business_id,name,address,phone,lat,lng,created_at,updated_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true }),
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
      supabaseUser.rpc("get_business_capabilities", { p_business_id: businessId }),
    ]);

    if (businessResult.error) throw businessResult.error;
    if (locationsResult.error) throw locationsResult.error;
    if (contactsResult.error) throw contactsResult.error;
    if (slowHoursResult.error) throw slowHoursResult.error;
    if (promotableItemsResult.error) throw promotableItemsResult.error;
    if (checklistResult.error) throw checklistResult.error;
    if (fieldSourcesResult.error) throw fieldSourcesResult.error;
    if (termsResult.error) throw termsResult.error;
    if (capabilitiesResult.error) throw capabilitiesResult.error;

    const business = businessResult.data as Record<string, unknown>;
    const capabilities = (capabilitiesResult.data ?? {}) as Record<string, unknown>;
    const publish = (capabilities.publish ?? {}) as { canPublish?: boolean; reason?: string; limits?: unknown };
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
      locations: locationsResult.data ?? [],
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
        can_edit_profile: capabilities.can_edit_business_information === true,
        can_use_setup_tools: capabilities.can_use_setup_tools === true,
        can_use_menu_tools: capabilities.can_use_menu_tools === true,
        can_extract_initial_menu: capabilities.can_extract_initial_menu === true,
        can_create_text_draft: capabilities.can_create_text_draft === true,
        can_create_offer_draft: capabilities.can_create_text_draft === true,
        can_generate_ai: capabilities.can_generate_ai === true,
        can_consume_offer_credits: capabilities.can_consume_offer_credits === true,
        can_publish_offer: capabilities.can_publish_offer === true,
        can_receive_new_claims: capabilities.can_receive_new_claims === true,
        can_redeem_existing_claims: capabilities.can_redeem_existing_claims === true,
        can_manage_billing: capabilities.can_manage_billing === true,
        reason_code: typeof capabilities.reason_code === "string" ? capabilities.reason_code : publish.reason ?? "pending_verification",
        limits: publish.limits ?? null,
        friendly_status_message: friendlyStatus(String(business.status ?? ""), String(business.access_level ?? "")),
      },
    });
  } catch (error) {
    console.error("[get-business-onboarding-context] error:", error);
    return json(req, { error: "Could not load business onboarding context." }, 500);
  }
});
