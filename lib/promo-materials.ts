import { supabase } from "./supabase";
import { EDGE_FUNCTION_TIMEOUT_MS, getErrorCode, parseFunctionError, throwInvokeError } from "./functions";

/**
 * Optional promotional-materials authorization.
 *
 * Deliberately separate from lib/business-terms.ts: accepting the Business
 * Terms never grants this permission, and nothing here gates publishing,
 * billing, trial, or verification.
 */

export type PromoAuthorizationStatus = {
  authorized: boolean;
  locationId: string | null;
  authorizedAt: string | null;
  revokedAt: string | null;
};

/** Sources an app client is allowed to claim; the server rejects anything else. */
export type PromoAuthorizationClientSource = "app_onboarding" | "app_settings";

// Mirrors readInvokeErrorBody in lib/business-terms.ts: edge functions return
// `{ error, error_code }` JSON on non-2xx responses, but supabase-js wraps that
// in a FunctionsHttpError whose body isn't pre-read.
async function readInvokeErrorBody(error: unknown): Promise<{ message?: string; code?: string }> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const data = await ctx.clone().json();
      if (data && typeof data === "object") {
        const o = data as { error?: unknown; error_code?: unknown };
        return {
          message: typeof o.error === "string" ? o.error : undefined,
          code: typeof o.error_code === "string" ? o.error_code : undefined,
        };
      }
    } catch {
      /* body wasn't JSON, or was already consumed — fall back to sync parsing */
    }
  }
  return {};
}

/**
 * Current status for a business. Reads the table directly (RLS member-read
 * allows it) rather than spending an edge-function round trip.
 *
 * Returns null when the table isn't readable — most often because the migration
 * hasn't been applied yet. Callers should hide the surface in that case rather
 * than showing a broken control.
 */
export async function getPromoMaterialsAuthorization(
  businessId: string,
): Promise<PromoAuthorizationStatus | null> {
  const { data, error } = await supabase
    .from("promo_materials_authorizations")
    .select("location_id,authorized_at,revoked_at")
    .eq("business_id", businessId)
    .is("revoked_at", null)
    .order("authorized_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const row = (data ?? [])[0] as
    | { location_id?: string | null; authorized_at?: string | null; revoked_at?: string | null }
    | undefined;
  return {
    authorized: Boolean(row),
    locationId: row?.location_id ?? null,
    authorizedAt: row?.authorized_at ?? null,
    revokedAt: row?.revoked_at ?? null,
  };
}

/** Grants or revokes the authorization. Revoking preserves history server-side. */
export async function setPromoMaterialsAuthorization(args: {
  businessId: string;
  action: "authorize" | "revoke";
  source: PromoAuthorizationClientSource;
  locationId?: string | null;
  authorizerName?: string | null;
  authorizerRole?: string | null;
}): Promise<PromoAuthorizationStatus> {
  const { data, error } = await supabase.functions.invoke("set-promo-materials-authorization", {
    body: {
      business_id: args.businessId,
      action: args.action,
      source: args.source,
      location_id: args.locationId ?? undefined,
      authorizer_name: args.authorizerName ?? undefined,
      authorizer_role: args.authorizerRole ?? undefined,
    },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) {
    const fromBody = await readInvokeErrorBody(error);
    throwInvokeError(fromBody.message ?? parseFunctionError(error), fromBody.code ?? getErrorCode(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    const response = data as { error?: string; error_code?: string };
    throwInvokeError(response.error ?? "Could not update promotional materials authorization.", response.error_code);
  }
  const response = (data ?? {}) as {
    authorized?: boolean;
    location_id?: string | null;
    authorized_at?: string | null;
    revoked_at?: string | null;
  };
  return {
    authorized: response.authorized === true,
    locationId: response.location_id ?? null,
    authorizedAt: response.authorized_at ?? null,
    revokedAt: response.revoked_at ?? null,
  };
}
