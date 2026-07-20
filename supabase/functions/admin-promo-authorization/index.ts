import {
  audit,
  cleanString,
  json,
  readPayload,
  requireAdmin,
  UUID_RE,
} from "../_shared/admin-prospects.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  findActiveAuthorization,
  grantAuthorization,
  revokeAuthorization,
} from "../_shared/promo-materials.ts";

/**
 * Admin-assisted recording of an in-person promotional-materials authorization.
 *
 * Every row written here is provenance-stamped `source: 'admin_assisted'` and
 * carries the identity of the person who actually gave permission. There is no
 * code path that lets an admin record a bare authorization: the required-field
 * checks below are mirrored by a CHECK constraint on the table, so the DB
 * refuses the insert even if this function is ever changed.
 */

function parseReceivedAt(value: unknown): string | null {
  const raw = cleanString(value, 40);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  // A permission received in the future is a data-entry error, not a consent.
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return parsed.toISOString();
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  const requestId = crypto.randomUUID();

  try {
    const ctx = await requireAdmin(req, requestId, "sales.write");
    if (ctx instanceof Response) return ctx;

    const payload = await readPayload(req);
    const action = cleanString(payload.action, 20) || "authorize";
    if (action !== "authorize" && action !== "revoke") {
      return json(req, { error: "Invalid action.", request_id: requestId }, 400);
    }

    const businessId = cleanString(payload.business_id, 80);
    const locationId = cleanString(payload.location_id, 80);
    if (!UUID_RE.test(businessId)) {
      return json(req, { error: "Business is required.", request_id: requestId }, 400);
    }
    // location_id is mandatory on the admin path: consent is per-location and an
    // admin must never have a location guessed on their behalf.
    if (!UUID_RE.test(locationId)) {
      return json(req, { error: "Location is required.", request_id: requestId }, 400);
    }

    const authorizerName = cleanString(payload.authorizer_name, 120);
    const authorizerRole = cleanString(payload.authorizer_role, 60);
    const permissionReceivedAt = parseReceivedAt(payload.permission_received_at);
    if (!authorizerName || !authorizerRole || !permissionReceivedAt) {
      return json(
        req,
        {
          error: "Authorizer name, authorizer role, and the date permission was received are all required.",
          request_id: requestId,
        },
        400,
      );
    }

    const { data: location, error: locationError } = await ctx.supabaseAdmin
      .from("business_locations")
      .select("id,business_id")
      .eq("id", locationId)
      .maybeSingle();
    if (locationError) throw locationError;
    if (!location || location.business_id !== businessId) {
      return json(req, { error: "Location does not belong to this business.", request_id: requestId }, 400);
    }

    if (action === "revoke") {
      const existing = await findActiveAuthorization(ctx.supabaseAdmin, locationId);
      if (!existing) {
        return json(req, { error: "No active authorization for this location.", request_id: requestId }, 404);
      }
      const revoked = await revokeAuthorization(ctx.supabaseAdmin, { locationId });
      await audit(ctx, {
        action: "admin_promo_authorization_revoked",
        targetType: "promo_materials_authorization",
        targetId: existing.id,
        businessId,
        beforeValue: existing,
        afterValue: revoked,
        reason: `revoked_on_behalf_of:${authorizerName} (${authorizerRole})`,
      });
      return json(req, {
        ok: true,
        request_id: requestId,
        authorized: false,
        authorization: revoked,
      });
    }

    const row = await grantAuthorization(ctx.supabaseAdmin, {
      businessId,
      locationId,
      source: "admin_assisted",
      authorizerName,
      authorizerRole,
      recordedByAdminUserId: ctx.adminUser.id,
      permissionReceivedAt,
    });

    await audit(ctx, {
      action: "admin_promo_authorization_recorded",
      targetType: "promo_materials_authorization",
      targetId: row.id,
      businessId,
      afterValue: row,
      reason: `recorded_on_behalf_of:${authorizerName} (${authorizerRole})`,
    });

    return json(req, {
      ok: true,
      request_id: requestId,
      authorized: true,
      authorization: row,
    });
  } catch (error) {
    console.error("[admin-promo-authorization] error:", error);
    return json(req, { error: "Could not record promotional materials authorization.", request_id: requestId }, 500);
  }
});
