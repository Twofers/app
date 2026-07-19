import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  calculateCompletionScore,
  cleanEmail,
  cleanString,
  normalizeCategory,
  normalizePhone,
  normalizeUrlOrHandle,
  upsertBusinessProfileForOwner,
} from "../_shared/business-onboarding-sync.ts";
import {
  BUSINESS_NAME_LOCKED_ERROR,
  isPublicBusinessStatus,
} from "../_shared/business-identity-lock.ts";
import { getBusinessCapabilities } from "../_shared/business-capabilities.ts";

type Payload = {
  business_id?: unknown;
  section_key?: unknown;
  profile_version?: unknown;
  payload?: unknown;
};

type DbClient = SupabaseClient<any, any, any, any, any>;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function assertCanEdit(
  supabase: DbClient,
  businessId: string,
  userId: string,
  email: string,
): Promise<boolean> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id,owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  const businessRow = business as { owner_id?: string } | null;
  if (!businessRow) return false;
  if (businessRow.owner_id === userId) return true;

  const { data: member, error: memberError } = await supabase
    .from("business_members")
    .select("id,role,status")
    .eq("business_id", businessId)
    .or(`user_id.eq.${userId},invited_email.eq.${email}`)
    .maybeSingle();
  if (memberError) throw memberError;
  const memberRow = member as { status?: string; role?: string } | null;
  return memberRow?.status === "active" && ["owner", "manager", "pending_owner"].includes(String(memberRow.role));
}

async function upsertFieldSource(
  supabase: DbClient,
  businessId: string,
  fieldKey: string,
  value: unknown,
  userId: string,
  requiresReview: boolean,
) {
  const { error } = await supabase.from("business_profile_field_sources").upsert(
    {
      business_id: businessId,
      field_key: fieldKey,
      source: "merchant_app_edit",
      current_value: value == null ? null : value,
      last_updated_at: new Date().toISOString(),
      last_updated_by_user_id: userId,
      requires_review: requiresReview,
      review_status: requiresReview ? "needs_review" : "not_required",
    },
    { onConflict: "business_id,field_key" },
  );
  if (error) throw error;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Business profile updates are not configured." }, 500);
    }

    const body = await req.json() as Payload;
    const businessId = body.business_id;
    const sectionKey = typeof body.section_key === "string" ? body.section_key : "full_profile";
    const profileVersion = typeof body.profile_version === "number" ? body.profile_version : Number(body.profile_version);
    const draft = asRecord(body.payload);
    if (!isUuid(businessId) || !Number.isFinite(profileVersion)) {
      return json(req, { error: "Invalid profile update." }, 400);
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

    if (!(await assertCanEdit(supabaseAdmin, businessId, user.id, email))) {
      return json(req, { error: "Forbidden." }, 403);
    }
    const capabilities = await getBusinessCapabilities(supabaseAdmin as any, businessId);
    if (!capabilities.can_edit_business_information) {
      return json(req, {
        error: "Business information is read-only for this account.",
        error_code: "BUSINESS_PROFILE_EDIT_CAPABILITY_REQUIRED",
        reason_code: capabilities.reason_code,
      }, 403);
    }

    const { data: current, error: currentError } = await supabaseAdmin
      .from("businesses")
      .select("id,owner_id,name,contact_name,business_email,phone,address,location,category,hours_text,tone,short_description,preferred_locale,latitude,longitude,status,verification_status,current_profile_version")
      .eq("id", businessId)
      .single();
    if (currentError) throw currentError;
    const currentVersion = Number(current.current_profile_version ?? 1);
    if (currentVersion !== profileVersion) {
      return json(req, {
        error: "profile_conflict",
        message: "This business profile changed on another device. Review the latest version before saving.",
        latest_context: { business: current },
      }, 409);
    }

    const name = cleanString(draft.name ?? draft.business_name, 120) ?? current.name;
    const contactName = cleanString(draft.contact_name ?? draft.contactName, 120);
    const publicEmail = cleanEmail(draft.business_email ?? draft.public_email ?? draft.email);
    const phone = normalizePhone(cleanString(draft.phone, 40));
    const address = cleanString(draft.address, 240);
    const category = normalizeCategory(cleanString(draft.category, 80));
    const hours = cleanString(draft.hours_text ?? draft.hours, 500);
    const tone = cleanString(draft.tone, 120);
    const location = cleanString(draft.location, 240) ?? address;
    const shortDescription = cleanString(draft.short_description ?? draft.shortDescription, 500);
    const preferredLocale = cleanString(draft.preferred_locale ?? draft.preferredLocale, 10);
    const latitude = draft.latitude === undefined ? current.latitude : optionalCoord(draft.latitude);
    const longitude = draft.longitude === undefined ? current.longitude : optionalCoord(draft.longitude);
    const websiteOrInstagram = cleanString(draft.website_or_instagram ?? draft.websiteOrInstagram, 180);
    const urlOrHandle = normalizeUrlOrHandle(websiteOrInstagram);

    if (!name || !String(name).trim() || (sectionKey !== "contact" && !address && !current.address)) {
      return json(req, { error: "Business name and address are required." }, 400);
    }

    // Identity lock: once the business is publicly visible its verified name
    // is frozen (spoof prevention — consumer surfaces live-join
    // businesses(name), so a rename retroactively rebrands live deals and
    // wallet claims). This function writes as service_role and bypasses the
    // enforce_businesses_protected_columns trigger, so the same rule is
    // enforced here. Renames go through business_name_change_requests and are
    // applied by admin-business-name-requests after review.
    const nameChanged = String(name).trim() !== String(current.name ?? "").trim();
    if (nameChanged && isPublicBusinessStatus(current.status)) {
      await supabaseAdmin.from("system_events").insert({
        event_type: "business_name_change_blocked",
        source: "mobile_app",
        message: "Post-approval business rename attempt rejected by update-business-profile-section.",
        metadata: {
          business_id: businessId,
          actor_user_id: user.id,
          section_key: sectionKey,
          current_name: current.name ?? null,
          attempted_name: String(name),
          business_status: current.status ?? null,
        },
      });
      return json(req, {
        error: BUSINESS_NAME_LOCKED_ERROR,
        code: BUSINESS_NAME_LOCKED_ERROR,
        message: "The business name is locked after approval. Submit a name change request for review.",
      }, 409);
    }

    const addressChanged = Boolean(address && address !== current.address);
    const phoneChanged = Boolean(phone && phone !== current.phone);
    const reviewRequired = (
      (addressChanged && ["limited_trial", "trialing", "active"].includes(String(current.status))) ||
      (phoneChanged && ["phone_verified", "basic_verified", "manual_verified"].includes(String(current.verification_status)))
    );
    const nextVersion = currentVersion + 1;
    const completionScore = calculateCompletionScore({
      businessName: String(name),
      category,
      email: publicEmail ?? current.business_email,
      phone: phone ?? current.phone,
      address: address ?? current.address,
      slowHours: hours ?? current.hours_text,
      termsAccepted: true,
    });

    const beforeValue = current;
    const updatePayload = {
      name,
      contact_name: contactName ?? current.contact_name ?? null,
      business_email: publicEmail ?? current.business_email ?? null,
      public_email: publicEmail ?? current.business_email ?? null,
      phone: phone ?? current.phone ?? null,
      address: address ?? current.address ?? null,
      location: location ?? current.location ?? address ?? current.address ?? null,
      category: category ?? current.category ?? null,
      hours_text: hours ?? current.hours_text ?? null,
      tone: tone ?? current.tone ?? null,
      short_description: shortDescription ?? current.short_description ?? null,
      preferred_locale: preferredLocale ?? current.preferred_locale ?? null,
      latitude,
      longitude,
      website_url: urlOrHandle.type === "website" ? urlOrHandle.value : null,
      instagram_url: urlOrHandle.type === "instagram" ? urlOrHandle.value : null,
      current_profile_version: nextVersion,
      profile_completion_score: completionScore,
      last_sensitive_edit_at: reviewRequired ? new Date().toISOString() : null,
      last_profile_completed_at: completionScore >= 80 ? new Date().toISOString() : null,
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("businesses")
      .update(updatePayload)
      .eq("id", businessId)
      .select("id,name,contact_name,business_email,phone,address,location,category,hours_text,short_description,latitude,longitude,status,access_level,verification_status,current_profile_version,profile_completion_score")
      .single();
    if (updateError) throw updateError;

    await upsertBusinessProfileForOwner(supabaseAdmin, {
      userId: user.id,
      name,
      address: address ?? current.address ?? null,
      category: category ?? current.category ?? null,
      setupCompleted: completionScore >= 60,
    });

    await Promise.all([
      upsertFieldSource(supabaseAdmin, businessId, "business.display_name", name, user.id, false),
      upsertFieldSource(supabaseAdmin, businessId, "business.category", category, user.id, false),
      upsertFieldSource(supabaseAdmin, businessId, "contact.public_email", publicEmail, user.id, false),
      upsertFieldSource(supabaseAdmin, businessId, "contact.phone", phone, user.id, phoneChanged && reviewRequired),
      upsertFieldSource(supabaseAdmin, businessId, "location.primary_address", address, user.id, addressChanged && reviewRequired),
    ]);

    if (hours) {
      await supabaseAdmin.from("business_slow_hours").delete().eq("business_id", businessId).eq("source", "merchant_app_edit");
      await supabaseAdmin.from("business_slow_hours").insert({
        business_id: businessId,
        label: "Owner confirmed",
        raw_text: hours,
        source: "merchant_app_edit",
        confirmed_at: new Date().toISOString(),
        confirmed_by_user_id: user.id,
      });
    }

    await supabaseAdmin.from("business_profile_revision_log").insert({
      business_id: businessId,
      actor_user_id: user.id,
      actor_type: "authenticated_business_owner",
      source: "merchant_app_edit",
      section_key: sectionKey,
      before_value: beforeValue,
      after_value: updated,
      requires_review: reviewRequired,
      review_status: reviewRequired ? "needs_review" : "not_required",
    });

    await supabaseAdmin.from("system_events").insert({
      event_type: "business_profile_section_edited",
      source: "mobile_app",
      message: "Business profile section edited.",
      metadata: { business_id: businessId, actor_user_id: user.id, section_key: sectionKey, requires_review: reviewRequired },
    });

    return json(req, {
      ok: true,
      business: updated,
      profile_version: nextVersion,
      requires_review: reviewRequired,
    });
  } catch (error) {
    console.error("[update-business-profile-section] error:", error);
    return json(req, { error: "Could not save business profile." }, 500);
  }
});
