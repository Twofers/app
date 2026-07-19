import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { isSuspendedBillingStatus } from "./billing-suspension.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

/**
 * `business_subscriptions` is the billing source of truth. This module mirrors
 * its state into `businesses.access_level` / `businesses.status` (what admin
 * reads) and into `location_entitlements` for the business's primary location
 * (what the app gate and server-side publish checks actually read). Every
 * writer of `business_subscriptions.app_access_status` — admin trial
 * creation, login materialization, the Stripe webhook, and the expiry sweeps
 * — must call `applyBusinessBillingAccessState` right after that write so the
 * business, application, and location mirrors never drift from billing again.
 */

const COMPED_ACCESS_LEVELS = new Set(["admin_comped", "partner_comped", "internal_test"]);

export function resolveBusinessAccessLevelForAppAccessStatus(params: {
  appAccessStatus: string;
  currentAccessLevel: string | null;
}): string | null {
  if (params.currentAccessLevel && COMPED_ACCESS_LEVELS.has(params.currentAccessLevel)) return null;
  switch (params.appAccessStatus) {
    case "approved_not_activated":
      return "approved_not_activated";
    case "active":
    case "past_due_grace":
      return "paid";
    case "trialing":
      return "full_trial";
    case "trial_limited":
      return "limited_trial";
    case "canceled":
    case "expired":
    case "blocked":
    case "suspended":
      return "none";
    default:
      return null;
  }
}

export function resolveBusinessStatusForAppAccessStatus(params: {
  appAccessStatus: string;
  currentAccessLevel: string | null;
}): string | null {
  if (params.currentAccessLevel && COMPED_ACCESS_LEVELS.has(params.currentAccessLevel)) return null;
  switch (params.appAccessStatus) {
    case "approved_not_activated":
      return "approved_not_activated";
    case "active":
      return "active";
    case "past_due_grace":
      return "past_due";
    case "trialing":
      return "trialing";
    case "trial_limited":
      return "limited_trial";
    case "canceled":
      return "canceled";
    default:
      return null;
  }
}

export function resolveBusinessApplicationStateForAppAccessStatus(appAccessStatus: string): {
  status: string;
  accessTier: string;
} | null {
  switch (appAccessStatus) {
    case "approved_not_activated":
      return { status: "approved_not_activated", accessTier: "approved_not_activated" };
    case "trial_limited":
      return { status: "trial_limited", accessTier: "trial_limited" };
    case "trialing":
      return { status: "trial_active", accessTier: "trialing" };
    case "active":
    case "past_due_grace":
      return { status: "active", accessTier: "active" };
    case "canceled":
      return { status: "canceled", accessTier: "canceled" };
    case "expired":
      return { status: "expired", accessTier: "expired" };
    case "blocked":
    case "suspended":
      return { status: "suspended", accessTier: "suspended" };
    default:
      return null;
  }
}

/**
 * `location_entitlements.status` is a gating cache, not a detailed ledger —
 * `business_subscriptions` keeps the precise reason. Returning null means
 * "leave any existing entitlement row alone" (comped accounts bypass the
 * location gate entirely via `businesses.access_level`).
 */
export function resolveLocationEntitlementStatus(params: {
  appAccessStatus: string;
  trialType: string | null;
  cancelAtPeriodEnd: boolean;
}): string | null {
  switch (params.appAccessStatus) {
    case "approved_not_activated":
      return "trial_eligible";
    case "trial_limited":
      return "admin_trial_active";
    case "trialing":
      if (params.trialType === "stripe_trial") {
        return params.cancelAtPeriodEnd ? "trial_canceling" : "trial_active";
      }
      return "admin_trial_active";
    case "active":
      return params.cancelAtPeriodEnd ? "pro_canceling" : "pro_active";
    case "past_due_grace":
      // Grace preserves access; the grace-expiry sweep downgrades explicitly
      // once `grace_period_until` passes without recovery.
      return "pro_active";
    case "canceled":
    case "expired":
    case "blocked":
    case "suspended":
      return "canceled_suspended";
    case "comped":
      return null;
    case "pending":
    default:
      return "trial_eligible";
  }
}

/**
 * Reads the business's oldest `business_locations` row (the pilot's single
 * location), auto-creating one from the business profile if none exists yet
 * — mirrors the same fallback `hooks/use-business-locations.ts` uses
 * client-side, so a server-created row looks identical to what the client
 * would have made and the client never creates a duplicate.
 */
export async function ensurePrimaryBusinessLocationId(
  supabase: DbClient,
  businessId: string,
): Promise<string | null> {
  const { data: existing, error: existingError } = await supabase
    .from("business_locations")
    .select("id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) return null;
  if (typeof existing?.id === "string") return existing.id;

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("name,address,location,phone,latitude,longitude")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError || !business) return null;

  const addr = [business.address, business.location]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean) || "See business profile";
  const label = typeof business.name === "string" && business.name.trim()
    ? `${business.name.trim()} — main`
    : "Primary location";

  const { data: inserted, error: insertError } = await supabase
    .from("business_locations")
    .insert({
      business_id: businessId,
      name: label,
      address: addr,
      phone: typeof business.phone === "string" && business.phone.trim() ? business.phone.trim() : null,
      lat: typeof business.latitude === "number" ? business.latitude : null,
      lng: typeof business.longitude === "number" ? business.longitude : null,
    })
    .select("id")
    .maybeSingle();
  if (insertError || typeof inserted?.id !== "string") return null;
  return inserted.id;
}

export type ApplyBusinessBillingAccessStateInput = {
  supabase: DbClient;
  businessId: string;
  provider: "admin" | "stripe";
  appAccessStatus: string;
  trialType: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export async function applyBusinessBillingAccessState(input: ApplyBusinessBillingAccessStateInput): Promise<void> {
  const { supabase, businessId } = input;

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("access_level,status")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;

  const currentAccessLevel = typeof business?.access_level === "string" ? business.access_level : null;
  const nextAccessLevel = resolveBusinessAccessLevelForAppAccessStatus({
    appAccessStatus: input.appAccessStatus,
    currentAccessLevel,
  });
  const nextStatus = resolveBusinessStatusForAppAccessStatus({
    appAccessStatus: input.appAccessStatus,
    currentAccessLevel,
  });
  if (nextAccessLevel || nextStatus) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (nextAccessLevel) patch.access_level = nextAccessLevel;
    if (nextStatus) patch.status = nextStatus;
    const { error } = await supabase.from("businesses").update(patch).eq("id", businessId);
    if (error) throw error;
  }

  const applicationState = resolveBusinessApplicationStateForAppAccessStatus(input.appAccessStatus);
  if (applicationState && !COMPED_ACCESS_LEVELS.has(currentAccessLevel ?? "")) {
    const { error } = await supabase
      .from("business_applications")
      .update({
        status: applicationState.status,
        access_tier: applicationState.accessTier,
        updated_at: new Date().toISOString(),
      })
      .eq("business_id", businessId);
    if (error) throw error;
  }

  const locationId = await ensurePrimaryBusinessLocationId(supabase, businessId);
  if (!locationId) return; // No location context yet; the next sync call will retry.

  const locationStatus = resolveLocationEntitlementStatus({
    appAccessStatus: input.appAccessStatus,
    trialType: input.trialType,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
  });
  if (!locationStatus) return; // Comped account — leave any existing entitlement row untouched.

  const now = new Date().toISOString();
  const suspended = isSuspendedBillingStatus(locationStatus);
  const { error: upsertError } = await supabase.from("location_entitlements").upsert(
    {
      business_location_id: locationId,
      status: locationStatus,
      entitlement_provider: input.provider,
      trial_started_at: input.trialStart,
      trial_ends_at: input.trialEnd,
      current_period_started_at: input.currentPeriodStart,
      current_period_ends_at: input.currentPeriodEnd,
      cancel_at_period_end: input.cancelAtPeriodEnd,
      suspended_at: suspended ? now : null,
      suspension_reason: suspended ? input.appAccessStatus : null,
      updated_at: now,
    },
    { onConflict: "business_location_id" },
  );
  if (upsertError) throw upsertError;
}
