import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type DbClient = SupabaseClient<any, any, any, any, any>;

export const CURRENT_BUSINESS_TERMS_VERSION = "2026-07-01";
export const CURRENT_PRIVACY_POLICY_VERSION = "2026-07-01";

export type NormalizedBusinessOnboarding = {
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  address: string | null;
  businessType: string | null;
  websiteOrInstagram: string | null;
  slowHours: string | null;
  offerInterests: string | null;
  launchArea: string | null;
  termsAccepted: boolean;
  privacyAcknowledged: boolean;
};

type MaterializeArgs = {
  userId: string;
  requestId?: string | null;
  applicationId?: string | null;
  normalized: NormalizedBusinessOnboarding;
  decision?: {
    status?: string | null;
    access_tier?: string | null;
    verification_status?: string | null;
    risk_score?: number | null;
  } | null;
  source: "website_signup" | "app_login" | "merchant_app_edit" | "admin_created";
};

export function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function cleanEmail(value: unknown): string | null {
  const email = cleanString(value, 254)?.toLowerCase() ?? null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits.slice(0, 18);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.slice(0, 18);
}

export function normalizeUrlOrHandle(value: string | null): { type: "website" | "instagram" | null; value: string | null } {
  if (!value) return { type: null, value: null };
  const trimmed = value.trim();
  if (!trimmed) return { type: null, value: null };
  const lower = trimmed.toLowerCase();
  if (lower.includes("instagram.com") || trimmed.startsWith("@")) {
    const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    return { type: "instagram", value: handle.slice(0, 180) };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return { type: "website", value: trimmed.slice(0, 180) };
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return { type: "website", value: `https://${trimmed}`.slice(0, 180) };
  return { type: "instagram", value: trimmed.slice(0, 180) };
}

export function normalizeCategory(value: string | null): string | null {
  const lower = value?.trim().toLowerCase() ?? "";
  if (!lower) return null;
  if (lower.includes("coffee")) return "cafe";
  if (lower.includes("cafe")) return "cafe";
  if (lower.includes("bakery")) return "bakery";
  if (lower.includes("restaurant")) return "restaurant";
  if (lower.includes("food truck")) return "restaurant";
  if (lower.includes("smoothie") || lower.includes("juice")) return "cafe";
  return value?.trim().slice(0, 80) ?? null;
}

function businessStatusFromDecision(status: string | null | undefined): string {
  if (status === "trial_limited") return "limited_trial";
  if (status === "trial_active" || status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "review_required") return "pending_verification";
  if (status === "waitlisted") return "pending_verification";
  if (status === "rejected") return "rejected";
  return "pending_verification";
}

function accessLevelFromDecision(accessTier: string | null | undefined): string {
  if (accessTier === "trial_limited") return "limited_trial";
  if (accessTier === "field_invited") return "limited_trial";
  if (accessTier === "trialing") return "full_trial";
  if (accessTier === "active") return "paid";
  if (accessTier === "waitlisted" || accessTier === "rejected") return "none";
  return "pending";
}

function verificationFromDecision(value: string | null | undefined): string {
  if (value === "verified_low_risk") return "basic_verified";
  if (value === "needs_review") return "needs_more_info";
  if (value === "rejected") return "failed";
  return "not_started";
}

export function parsePromotableItems(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/,|\band\b|;|\n/i)
    .map((item) => item.trim().replace(/^[-*]\s*/, ""))
    .filter((item) => item.length >= 2)
    .slice(0, 8)
    .map((item) => item.slice(0, 120));
}

export function calculateCompletionScore(values: {
  businessName?: string | null;
  category?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  slowHours?: string | null;
  offerInterests?: string | null;
  termsAccepted?: boolean | null;
}): number {
  let score = 0;
  if (values.businessName?.trim()) score += 10;
  if (values.category?.trim()) score += 10;
  if (values.email?.trim()) score += 10;
  if (values.phone?.trim()) score += 10;
  if (values.address?.trim()) score += 20;
  if (values.slowHours?.trim()) score += 15;
  if (values.offerInterests?.trim()) score += 10;
  if (values.termsAccepted) score += 10;
  return Math.min(100, score);
}

async function upsertContactChannel(
  supabase: DbClient,
  businessId: string,
  type: string,
  value: string | null,
  source: string,
) {
  if (!value) return;
  const normalizedValue = type === "phone" ? normalizePhone(value) : value.trim().toLowerCase();
  const { data: existing, error: selectError } = await supabase
    .from("business_contact_channels")
    .select("id")
    .eq("business_id", businessId)
    .eq("type", type)
    .eq("is_primary", true)
    .maybeSingle();
  if (selectError) throw selectError;
  const payload = {
    business_id: businessId,
    type,
    value,
    normalized_value: normalizedValue,
    is_primary: true,
    is_public: true,
    source,
  };
  if (existing?.id) {
    const { error } = await supabase.from("business_contact_channels").update(payload).eq("id", existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("business_contact_channels").insert(payload);
  if (error) throw error;
}

async function upsertFieldSource(
  supabase: DbClient,
  businessId: string,
  fieldKey: string,
  source: string,
  value: unknown,
  sourceRecordId?: string | null,
  requiresReview = false,
) {
  const { error } = await supabase.from("business_profile_field_sources").upsert(
    {
      business_id: businessId,
      field_key: fieldKey,
      source,
      source_record_id: sourceRecordId ?? null,
      source_value: value == null ? null : value,
      current_value: value == null ? null : value,
      last_updated_at: new Date().toISOString(),
      requires_review: requiresReview,
      review_status: requiresReview ? "needs_review" : "not_required",
    },
    { onConflict: "business_id,field_key" },
  );
  if (error) throw error;
}

async function ensureBusinessInviteValidation(supabase: DbClient, userId: string, source: string) {
  const { error } = await supabase.from("business_invite_validations").upsert(
    {
      user_id: userId,
      validated_at: new Date().toISOString(),
      code_used: source === "admin_created" ? "admin_onboarding" : "reviewed_onboarding",
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

async function seedChecklist(supabase: DbClient, businessId: string, imported: NormalizedBusinessOnboarding) {
  const rows = [
    ["review_business_basics", "Review business basics", imported.businessName ? "imported" : "not_started"],
    ["confirm_location", "Confirm location", imported.address ? "imported" : "not_started"],
    ["verify_contact_info", "Verify contact info", imported.email || imported.phone ? "imported" : "not_started"],
    ["confirm_slow_hours", "Confirm slow hours", imported.slowHours ? "imported" : "not_started"],
    ["review_promotable_items", "Review items to promote", imported.offerInterests ? "imported" : "not_started"],
    ["create_first_offer_draft", "Create first offer draft", imported.offerInterests ? "in_progress" : "not_started"],
    ["review_offer_terms", "Review offer terms", "not_started"],
    ["complete_redemption_training", "Complete redemption training", "not_started"],
    ["confirm_staff_ready", "Confirm staff readiness", "not_started"],
    ["await_admin_approval", "Await admin approval", "needs_review"],
  ].map(([item_key, label, status]) => ({
    business_id: businessId,
    item_key,
    label,
    status,
    is_required: true,
  }));
  const { error } = await supabase.from("business_setup_checklist").upsert(rows, {
    onConflict: "business_id,item_key",
  });
  if (error) throw error;
}

async function syncDerivedRows(
  supabase: DbClient,
  businessId: string,
  normalized: NormalizedBusinessOnboarding,
  source: string,
  sourceRecordId?: string | null,
  actorUserId?: string | null,
) {
  const urlOrHandle = normalizeUrlOrHandle(normalized.websiteOrInstagram);
  await upsertContactChannel(supabase, businessId, "email", normalized.email, source);
  await upsertContactChannel(supabase, businessId, "phone", normalized.phone, source);
  if (urlOrHandle.type && urlOrHandle.value) {
    await upsertContactChannel(supabase, businessId, urlOrHandle.type, urlOrHandle.value, source);
  }

  if (normalized.slowHours) {
    await supabase.from("business_slow_hours").delete().eq("business_id", businessId).eq("source", "website_signup");
    const { error } = await supabase.from("business_slow_hours").insert({
      business_id: businessId,
      label: "Website request",
      raw_text: normalized.slowHours,
      confidence: 0.5,
      source,
    });
    if (error) throw error;
  }

  const items = parsePromotableItems(normalized.offerInterests);
  if (items.length > 0) {
    await supabase.from("business_promotable_items").delete().eq("business_id", businessId).eq("source", "website_signup");
    const { error } = await supabase.from("business_promotable_items").insert(
      items.map((name) => ({
        business_id: businessId,
        name,
        source_raw_text: normalized.offerInterests,
        source,
        suggested_offer_type: "bogo",
      })),
    );
    if (error) throw error;
  }

  if (normalized.termsAccepted) {
    const { error } = await supabase.from("terms_acceptances").upsert(
      {
        business_id: businessId,
        user_id: actorUserId ?? null,
        document_type: "business_terms",
        document_version: CURRENT_BUSINESS_TERMS_VERSION,
        source,
      },
      { onConflict: "business_id,document_type,document_version,source" },
    );
    if (error) throw error;
  }
  if (normalized.privacyAcknowledged) {
    const { error } = await supabase.from("terms_acceptances").upsert(
      {
        business_id: businessId,
        user_id: actorUserId ?? null,
        document_type: "privacy_policy",
        document_version: CURRENT_PRIVACY_POLICY_VERSION,
        source,
      },
      { onConflict: "business_id,document_type,document_version,source" },
    );
    if (error) throw error;
  }

  await seedChecklist(supabase, businessId, normalized);
  await upsertFieldSource(supabase, businessId, "business.display_name", source, normalized.businessName, sourceRecordId);
  await upsertFieldSource(supabase, businessId, "business.category", source, normalizeCategory(normalized.businessType), sourceRecordId);
  await upsertFieldSource(supabase, businessId, "location.primary_address", source, normalized.address, sourceRecordId);
  await upsertFieldSource(supabase, businessId, "contact.public_email", source, normalized.email, sourceRecordId);
  await upsertFieldSource(supabase, businessId, "contact.phone", source, normalized.phone, sourceRecordId);
  await upsertFieldSource(supabase, businessId, "slow_hours.raw_text", source, normalized.slowHours, sourceRecordId);
  await upsertFieldSource(supabase, businessId, "promotable_items.raw_text", source, normalized.offerInterests, sourceRecordId);
}

export async function upsertBusinessProfileForOwner(
  supabase: DbClient,
  args: {
    userId: string;
    name: string;
    address: string | null;
    category: string | null;
    setupCompleted: boolean;
  },
) {
  const payload = {
    user_id: args.userId,
    owner_id: args.userId,
    name: args.name,
    address: args.address,
    category: args.category,
    setup_completed: args.setupCompleted,
  };
  const { data: existing, error: existingError } = await supabase
    .from("business_profiles")
    .select("id")
    .or(`user_id.eq.${args.userId},owner_id.eq.${args.userId}`)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) {
    const { error } = await supabase.from("business_profiles").update(payload).eq("id", existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("business_profiles").insert(payload);
  if (error) throw error;
}

export async function materializeBusinessForUser(
  supabase: DbClient,
  args: MaterializeArgs,
): Promise<{ businessId: string; created: boolean }> {
  const category = normalizeCategory(args.normalized.businessType);
  const score = calculateCompletionScore({
    businessName: args.normalized.businessName,
    category,
    email: args.normalized.email,
    phone: args.normalized.phone,
    address: args.normalized.address,
    slowHours: args.normalized.slowHours,
    offerInterests: args.normalized.offerInterests,
    termsAccepted: args.normalized.termsAccepted,
  });
  const urlOrHandle = normalizeUrlOrHandle(args.normalized.websiteOrInstagram);
  const basePayload = {
    name: args.normalized.businessName,
    contact_name: args.normalized.contactName,
    business_email: args.normalized.email,
    public_email: args.normalized.email,
    phone: normalizePhone(args.normalized.phone),
    address: args.normalized.address,
    location: args.normalized.address,
    category,
    hours_text: args.normalized.slowHours,
    website_url: urlOrHandle.type === "website" ? urlOrHandle.value : null,
    instagram_url: urlOrHandle.type === "instagram" ? urlOrHandle.value : null,
    status: businessStatusFromDecision(args.decision?.status),
    access_level: accessLevelFromDecision(args.decision?.access_tier),
    verification_status: verificationFromDecision(args.decision?.verification_status),
    risk_score: args.decision?.risk_score ?? null,
    risk_level: args.decision?.risk_score == null ? null : args.decision.risk_score >= 70 ? "low" : args.decision.risk_score >= 40 ? "medium" : "high",
    source: args.source,
    source_onboarding_request_id: args.requestId ?? null,
    profile_completion_score: score,
    last_profile_completed_at: score >= 80 ? new Date().toISOString() : null,
  };

  const { data: existing, error: existingError } = await supabase
    .from("businesses")
    .select("id,current_profile_version")
    .eq("owner_id", args.userId)
    .maybeSingle();
  if (existingError) throw existingError;

  let businessId = existing?.id as string | undefined;
  let created = false;
  if (businessId) {
    const existingVersion = Number((existing as { current_profile_version?: unknown }).current_profile_version ?? 1);
    const { error } = await supabase
      .from("businesses")
      .update({ ...basePayload, current_profile_version: existingVersion + 1 })
      .eq("id", businessId);
    if (error) throw error;
  } else {
    await ensureBusinessInviteValidation(supabase, args.userId, args.source);
    const { data, error } = await supabase
      .from("businesses")
      .insert({ owner_id: args.userId, ...basePayload })
      .select("id")
      .single();
    if (error) throw error;
    businessId = data.id as string;
    created = true;
  }

  await upsertBusinessProfileForOwner(supabase, {
    userId: args.userId,
    name: args.normalized.businessName,
    address: args.normalized.address,
    category,
    setupCompleted: score >= 60,
  });

  const { error: memberError } = await supabase.from("business_members").upsert(
    {
      business_id: businessId,
      user_id: args.userId,
      invited_email: args.normalized.email,
      display_name: args.normalized.contactName,
      role: "owner",
      status: "active",
      source: args.source,
      linked_at: new Date().toISOString(),
    },
    { onConflict: "business_id,invited_email" },
  );
  if (memberError) throw memberError;

  await syncDerivedRows(supabase, businessId, args.normalized, args.source, args.requestId ?? args.applicationId ?? null, args.userId);

  if (args.requestId) {
    await supabase.from("business_onboarding_requests").update({ business_id: businessId, status: "materialized" }).eq("id", args.requestId);
    await supabase
      .from("business_invites")
      .update({
        business_id: businessId,
        accepted_by_user_id: args.userId,
        accepted_at: new Date().toISOString(),
        status: "accepted",
      })
      .eq("onboarding_request_id", args.requestId)
      .eq("invited_email", args.normalized.email);
  }
  if (args.applicationId) {
    await supabase.from("business_applications").update({ business_id: businessId, onboarding_request_id: args.requestId ?? null }).eq("id", args.applicationId);
  }

  await supabase.from("business_profile_revision_log").insert({
    business_id: businessId,
    actor_user_id: args.userId,
    actor_type: args.source === "merchant_app_edit" ? "authenticated_business_owner" : "system",
    source: args.source,
    section_key: created ? "website_import" : "website_import_update",
    after_value: args.normalized,
    reason: "business_onboarding_sync",
  });

  return { businessId, created };
}

export async function createOnboardingRequest(
  supabase: DbClient,
  normalized: NormalizedBusinessOnboarding,
  rawPayload: Record<string, unknown>,
  args: {
    applicationId?: string | null;
    status: string;
    riskScore?: number | null;
    riskLevel?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("business_onboarding_requests")
    .insert({
      application_id: args.applicationId ?? null,
      owner_name: normalized.contactName,
      owner_email: normalized.email,
      phone: normalized.phone,
      business_name: normalized.businessName,
      business_address: normalized.address,
      business_type: normalized.businessType,
      website_or_instagram: normalized.websiteOrInstagram,
      best_slow_hours: normalized.slowHours,
      promote_text: normalized.offerInterests,
      launch_area_confirmed: Boolean(normalized.launchArea),
      accepted_business_terms: normalized.termsAccepted,
      accepted_privacy_policy: normalized.privacyAcknowledged,
      accepted_business_terms_version: "2026-07-01",
      accepted_privacy_policy_version: "2026-07-01",
      raw_payload: rawPayload,
      normalized_payload: normalized,
      status: args.status === "trial_limited" ? "trial_limited" : args.status === "waitlisted" ? "waitlisted" : args.status === "rejected" ? "rejected" : "submitted",
      risk_score: args.riskScore ?? null,
      risk_level: args.riskLevel ?? null,
      ip_address: args.ipAddress ?? null,
      user_agent: args.userAgent ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const requestId = data.id as string;
  const { error: inviteError } = await supabase.from("business_invites").insert({
    onboarding_request_id: requestId,
    invited_email: normalized.email,
    role: "pending_owner",
    status: "pending",
    source: "website_signup",
  });
  if (inviteError) throw inviteError;
  return requestId;
}
