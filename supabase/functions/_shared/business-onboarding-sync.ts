import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  CURRENT_BUSINESS_TERMS_VERSION,
  CURRENT_PRIVACY_POLICY_VERSION,
} from "./business-terms-version.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

// Re-exported so existing importers (accept-business-terms and friends) keep
// their current import path; the constants themselves live in
// business-terms-version.ts.
export { CURRENT_BUSINESS_TERMS_VERSION, CURRENT_PRIVACY_POLICY_VERSION };

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
  /**
   * Optional, opt-in only. Recorded as a *preference* on the application
   * (business_applications.promo_materials_authorized) and carried in
   * normalized_payload — it never grants anything by itself, and accepting the
   * terms above must never imply this permission.
   *
   * The actual authorization row is written only by the authenticated owner
   * via set-promo-materials-authorization (or by an admin via
   * admin-promo-authorization) — the same posture terms acceptance has.
   * This module used to grant it inline from an unauthenticated website
   * signup; that path was unreachable and has been removed. Decided with Dan
   * 2026-07-19; see docs/plans/promo-materials-authorization-plan.md.
   */
  promoMaterialsAuthorized?: boolean;
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
      accepted_business_terms_version: CURRENT_BUSINESS_TERMS_VERSION,
      accepted_privacy_policy_version: CURRENT_PRIVACY_POLICY_VERSION,
      raw_payload: rawPayload,
      normalized_payload: normalized,
      status: args.status === "trial_limited"
        ? "trial_limited"
        : args.status === "approved_not_activated"
        ? "approved_not_activated"
        : args.status === "waitlisted"
        ? "waitlisted"
        : args.status === "rejected"
        ? "rejected"
        : "submitted",
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
