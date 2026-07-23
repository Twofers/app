import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { CURRENT_BUSINESS_TERMS_VERSION } from "./business-terms-version.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

/**
 * Where a promotional-materials authorization came from.
 *
 * `admin_assisted` and `website_onboarding` are server-decided only — the app
 * client may never assert them (see CLIENT_PROMO_SOURCES).
 */
export type PromoAuthorizationSource =
  | "app_onboarding"
  | "app_settings"
  | "website_onboarding"
  | "admin_assisted";

/** The only sources an authenticated app client is allowed to claim. */
export const CLIENT_PROMO_SOURCES: PromoAuthorizationSource[] = ["app_onboarding", "app_settings"];

export type PromoAuthorizationRow = {
  id: string;
  business_id: string;
  location_id: string;
  authorized_at: string | null;
  revoked_at: string | null;
  authorizer_name: string | null;
  authorizer_role: string | null;
  business_terms_version: string | null;
  source: string;
  permission_received_at: string | null;
  created_at: string | null;
};

const AUTHORIZATION_COLUMNS =
  "id,business_id,location_id,authorized_at,revoked_at,authorizer_name,authorizer_role,business_terms_version,source,permission_received_at,created_at";

export function isClientPromoSource(value: unknown): value is "app_onboarding" | "app_settings" {
  return typeof value === "string" && (CLIENT_PROMO_SOURCES as string[]).includes(value);
}

export type ResolveLocationResult =
  | { ok: true; locationId: string }
  | { ok: false; error: string; status: number };

/**
 * Resolve the location a consent applies to.
 *
 * Consent is per-location, so an explicit `location_id` always wins (after an
 * ownership check). With no hint we use the business's single location; if none
 * exists yet we create the primary one server-side, because
 * `hooks/use-business-locations.ts` only creates it lazily on first mount and
 * onboarding consent can land before that. With several locations and no hint
 * we refuse rather than guess.
 */
export async function resolvePrimaryLocationId(
  supabase: DbClient,
  businessId: string,
  requestedLocationId?: string | null,
): Promise<ResolveLocationResult> {
  if (requestedLocationId) {
    const { data, error } = await supabase
      .from("business_locations")
      .select("id,business_id")
      .eq("id", requestedLocationId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { id?: string; business_id?: string } | null;
    if (!row || row.business_id !== businessId) {
      return { ok: false, error: "Location does not belong to this business.", status: 400 };
    }
    return { ok: true, locationId: row.id as string };
  }

  const { data: existing, error: listError } = await supabase
    .from("business_locations")
    .select("id")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (listError) throw listError;
  const rows = (existing ?? []) as { id: string }[];
  if (rows.length === 1) return { ok: true, locationId: rows[0].id };
  if (rows.length > 1) {
    return { ok: false, error: "This business has multiple locations; location_id is required.", status: 400 };
  }

  // Mirror the shape hooks/use-business-locations.ts creates so the two paths
  // can't drift into producing differently-named "primary" rows.
  const { data: biz, error: bizError } = await supabase
    .from("businesses")
    .select("name,address,location,phone,latitude,longitude")
    .eq("id", businessId)
    .maybeSingle();
  if (bizError) throw bizError;
  const bizRow = (biz ?? {}) as {
    name?: string | null;
    address?: string | null;
    location?: string | null;
    phone?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  const address =
    [bizRow.address, bizRow.location].map((s) => (typeof s === "string" ? s.trim() : "")).find(Boolean) ||
    "See business profile";
  const name =
    typeof bizRow.name === "string" && bizRow.name.trim() ? `${bizRow.name.trim()} — main` : "Primary location";

  const { data: inserted, error: insertError } = await supabase
    .from("business_locations")
    .insert({
      business_id: businessId,
      name,
      address,
      phone: typeof bizRow.phone === "string" && bizRow.phone.trim() ? bizRow.phone.trim() : null,
      lat: typeof bizRow.latitude === "number" ? bizRow.latitude : null,
      lng: typeof bizRow.longitude === "number" ? bizRow.longitude : null,
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return { ok: true, locationId: (inserted as { id: string }).id };
}

/** The open (un-revoked) authorization for a location, if any. */
export async function findActiveAuthorization(
  supabase: DbClient,
  locationId: string,
): Promise<PromoAuthorizationRow | null> {
  const { data, error } = await supabase
    .from("promo_materials_authorizations")
    .select(AUTHORIZATION_COLUMNS)
    .eq("location_id", locationId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as PromoAuthorizationRow | null;
}

/**
 * Grant consent for a location. Idempotent: an already-open row is returned
 * unchanged rather than duplicated (the partial unique index backs this up).
 */
export async function grantAuthorization(
  supabase: DbClient,
  args: {
    businessId: string;
    locationId: string;
    source: PromoAuthorizationSource;
    userId?: string | null;
    authorizerName?: string | null;
    authorizerRole?: string | null;
    recordedByAdminUserId?: string | null;
    permissionReceivedAt?: string | null;
  },
): Promise<PromoAuthorizationRow> {
  const active = await findActiveAuthorization(supabase, args.locationId);
  if (active) return active;

  const { data, error } = await supabase
    .from("promo_materials_authorizations")
    .insert({
      business_id: args.businessId,
      location_id: args.locationId,
      user_id: args.userId ?? null,
      authorizer_name: args.authorizerName ?? null,
      authorizer_role: args.authorizerRole ?? null,
      business_terms_version: CURRENT_BUSINESS_TERMS_VERSION,
      source: args.source,
      recorded_by_admin_user_id: args.recordedByAdminUserId ?? null,
      permission_received_at: args.permissionReceivedAt ?? null,
    })
    .select(AUTHORIZATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as PromoAuthorizationRow;
}

/**
 * Revoke consent for a location by stamping revoked_at on the open row.
 * Never deletes — the row stays as history. Returns null when nothing was open.
 */
export async function revokeAuthorization(
  supabase: DbClient,
  args: { locationId: string; revokedByUserId?: string | null },
): Promise<PromoAuthorizationRow | null> {
  const active = await findActiveAuthorization(supabase, args.locationId);
  if (!active) return null;

  const { data, error } = await supabase
    .from("promo_materials_authorizations")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: args.revokedByUserId ?? null,
    })
    .eq("id", active.id)
    .is("revoked_at", null)
    .select(AUTHORIZATION_COLUMNS)
    .single();
  if (error) throw error;
  return data as PromoAuthorizationRow;
}
