import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  findActiveAuthorization,
  grantAuthorization,
  isClientPromoSource,
  resolvePrimaryLocationId,
  revokeAuthorization,
} from "../_shared/promo-materials.ts";
import { tryGetServiceRoleKey } from "../_shared/service-role-key.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

type Payload = {
  business_id?: unknown;
  location_id?: unknown;
  action?: unknown;
  source?: unknown;
  authorizer_name?: unknown;
  authorizer_role?: unknown;
};

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function cleanShortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * Owner or an active owner/manager member may authorize or revoke on behalf of
 * the business. Mirrors accept-business-terms' assertCanAccept so the two
 * "who can act for this business" checks stay in sync; returns the member role
 * so it can be recorded as authorizer_role.
 */
async function resolveActorRole(
  supabase: DbClient,
  businessId: string,
  userId: string,
  email: string,
): Promise<string | null> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id,owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  const businessRow = business as { owner_id?: string } | null;
  if (!businessRow) return null;
  if (businessRow.owner_id === userId) return "owner";

  const { data: member, error: memberError } = await supabase
    .from("business_members")
    .select("id,role,status")
    .eq("business_id", businessId)
    .or(`user_id.eq.${userId},invited_email.eq.${email}`)
    .maybeSingle();
  if (memberError) throw memberError;
  const memberRow = member as { status?: string; role?: string } | null;
  if (memberRow?.status !== "active") return null;
  const role = String(memberRow.role);
  return ["owner", "manager"].includes(role) ? role : null;
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
    const serviceRoleKey = tryGetServiceRoleKey();
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Promotional materials authorization is not configured." }, 500);
    }

    const body = (await req.json().catch(() => ({}))) as Payload;
    const businessId = body.business_id;
    if (!isUuid(businessId)) {
      return json(req, { error: "Invalid business_id." }, 400);
    }
    const action = body.action;
    if (action !== "authorize" && action !== "revoke") {
      return json(req, { error: "Invalid action." }, 400);
    }
    if (body.location_id != null && !isUuid(body.location_id)) {
      return json(req, { error: "Invalid location_id." }, 400);
    }
    // The client may only ever claim an in-app source. website_onboarding and
    // admin_assisted are server-decided in their own code paths.
    const source = isClientPromoSource(body.source) ? body.source : "app_settings";

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
    const email = user.email?.trim().toLowerCase() ?? "";

    const actorRole = await resolveActorRole(supabaseAdmin, businessId, user.id, email);
    if (!actorRole) {
      return json(req, { error: "Forbidden." }, 403);
    }

    const resolved = await resolvePrimaryLocationId(
      supabaseAdmin,
      businessId,
      isUuid(body.location_id) ? body.location_id : null,
    );
    if (!resolved.ok) {
      return json(req, { error: resolved.error }, resolved.status);
    }
    const locationId = resolved.locationId;

    if (action === "authorize") {
      const row = await grantAuthorization(supabaseAdmin, {
        businessId,
        locationId,
        source,
        userId: user.id,
        // Only name and role are collected — nothing beyond what identifies the
        // person who authorized. Role defaults to the caller's membership role.
        authorizerName: cleanShortText(body.authorizer_name, 120),
        authorizerRole: cleanShortText(body.authorizer_role, 60) ?? actorRole,
      });

      await supabaseAdmin.from("business_profile_revision_log").insert({
        business_id: businessId,
        actor_user_id: user.id,
        actor_type: "authenticated_business_owner",
        source,
        section_key: "promo_materials_authorization",
        after_value: { authorized: true, location_id: locationId, source },
        reason: "owner_authorized_promo_materials",
      });

      return json(req, {
        authorized: true,
        location_id: locationId,
        authorized_at: row.authorized_at,
        revoked_at: null,
      });
    }

    const revoked = await revokeAuthorization(supabaseAdmin, {
      locationId,
      revokedByUserId: user.id,
    });
    if (!revoked) {
      // Nothing was open — already the desired end state, so report it as such
      // rather than erroring the client into a stuck toggle.
      const current = await findActiveAuthorization(supabaseAdmin, locationId);
      return json(req, {
        authorized: Boolean(current),
        location_id: locationId,
        authorized_at: current?.authorized_at ?? null,
        revoked_at: null,
      });
    }

    await supabaseAdmin.from("business_profile_revision_log").insert({
      business_id: businessId,
      actor_user_id: user.id,
      actor_type: "authenticated_business_owner",
      source,
      section_key: "promo_materials_authorization",
      after_value: { authorized: false, location_id: locationId, source },
      reason: "owner_revoked_promo_materials",
    });

    return json(req, {
      authorized: false,
      location_id: locationId,
      authorized_at: revoked.authorized_at,
      revoked_at: revoked.revoked_at,
    });
  } catch (error) {
    console.error("[set-promo-materials-authorization] error:", error);
    return json(req, { error: "Could not update promotional materials authorization." }, 500);
  }
});
