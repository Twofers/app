import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { isAal2 } from "../_shared/admin-mfa.ts";
import {
  AI_QUOTA_SCOPES,
  countAiQuotaUsage,
  isAiQuotaScope,
  utcMonthStartIso,
  type AiQuotaScope,
} from "../_shared/ai-quota-resets.ts";
import { resolveDealTranslateMonthlyLimit } from "../_shared/deal-translate-limit.ts";
import { tryGetServiceRoleKey } from "../_shared/service-role-key.ts";

type AdminRole =
  | "owner"
  | "admin"
  | "support"
  | "sales"
  | "finance"
  | "moderator"
  | "developer"
  | "read_only";

type AdminContext = {
  user: { id: string; email?: string | null };
  adminUser: {
    email?: string | null;
    role: AdminRole;
    display_name?: string | null;
  };
  supabaseAdmin: any;
  requestId: string;
};

type Payload = {
  action?: unknown;
  query?: unknown;
  email?: unknown;
  user_id?: unknown;
  business_id?: unknown;
  quota_scope?: unknown;
  reason?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hasReadableAdminRole(role: unknown): role is AdminRole {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "support" ||
    role === "sales" ||
    role === "finance" ||
    role === "moderator" ||
    role === "developer" ||
    role === "read_only"
  );
}

function canResetQuota(role: AdminRole): boolean {
  return role === "owner" || role === "admin" || role === "support" || role === "developer";
}

// deal_translate is sized per business (4x its deal-credit allowance); the
// remaining scopes stay flat env-configured caps.
async function quotaLimit(scope: AiQuotaScope, supabaseAdmin: any, businessId: string): Promise<number> {
  if (scope === "deal_translate") {
    return resolveDealTranslateMonthlyLimit(supabaseAdmin, businessId);
  }
  const envName = {
    ad_generation: "AI_MONTHLY_LIMIT",
    compose_offer: "AI_MONTHLY_LIMIT",
    deal_copy: "AI_COPY_MONTHLY_LIMIT",
    deal_suggestions: "AI_INSIGHTS_MONTHLY_LIMIT",
    deal_translate: "AI_TRANSLATE_MONTHLY_LIMIT",
  }[scope];
  const value = Number(Deno.env.get(envName) ?? "30");
  return Number.isFinite(value) && value > 0 ? value : 30;
}

async function readPayload(req: Request): Promise<Payload> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function requireAdmin(req: Request, requestId: string): Promise<AdminContext | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = tryGetServiceRoleKey();
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Admin AI usage is not configured." }, 500);
  }

  const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();

  if (userError || !user) {
    return json(req, { error: "Unauthorized." }, 401);
  }
  if (isRedeemerUser(user)) {
    return forbiddenForRedeemerResponse(getCorsHeaders(req));
  }

  const { data: adminUser, error: adminError } = await supabaseAdmin
    .from("admin_users")
    .select("id,email,role,is_active,require_mfa,display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (adminError) throw adminError;
  if (!adminUser?.is_active || !hasReadableAdminRole(adminUser.role)) {
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: user.email ?? null,
      action: "admin_ai_usage_denied",
      target_type: "ai_quota",
      reason: "not_active_admin",
      request_id: requestId,
    });
    return json(req, { error: "Forbidden." }, 403);
  }
  if (adminUser.require_mfa && !isAal2(bearerToken)) {
    return json(req, { error: "MFA verification required." }, 403);
  }

  return {
    user: { id: user.id, email: user.email },
    adminUser: {
      email: adminUser.email,
      role: adminUser.role,
      display_name: adminUser.display_name,
    },
    supabaseAdmin,
    requestId,
  };
}

async function authUserById(supabaseAdmin: any, userId: string) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) return null;
  return data?.user ?? null;
}

async function authUserByEmail(supabaseAdmin: any, email: string) {
  const target = email.trim().toLowerCase();
  if (!target) return null;

  // Resolve via a direct, indexed lookup instead of the GoTrue admin user-list
  // scan, which returns "Database error finding users" (HTTP 500) at larger page
  // sizes when any auth.users row is malformed — that crashed this whole lookup.
  // See migration 20260808130000_admin_user_id_by_email_rpc.sql.
  const { data, error } = await supabaseAdmin.rpc("admin_user_id_by_email", { p_email: target });
  if (error) throw error;

  const userId = typeof data === "string" ? data : null;
  if (!userId || !UUID_RE.test(userId)) return null;

  return authUserById(supabaseAdmin, userId);
}

async function resolveTargetUser(supabaseAdmin: any, payload: Payload) {
  const explicitUserId = cleanString(payload.user_id);
  const query = cleanString(payload.query || payload.email);

  if (explicitUserId && UUID_RE.test(explicitUserId)) {
    return authUserById(supabaseAdmin, explicitUserId);
  }

  if (query && UUID_RE.test(query)) {
    return authUserById(supabaseAdmin, query);
  }

  if (query && query.includes("@")) {
    return authUserByEmail(supabaseAdmin, query);
  }

  return null;
}

async function businessMemberIdsForUser(
  supabaseAdmin: any,
  user: { id: string; email?: string | null },
): Promise<string[]> {
  const filters = [`user_id.eq.${user.id}`];
  const email = cleanString(user.email).toLowerCase();
  if (email) {
    filters.push(`invited_email.eq.${email}`);
  }

  const { data, error } = await supabaseAdmin
    .from("business_members")
    .select("business_id")
    .or(filters.join(","));

  if (error) {
    console.warn(JSON.stringify({
      tag: "admin_ai_usage",
      event: "business_members_lookup_failed",
      errorCode: "BUSINESS_MEMBERS_LOOKUP_FAILED",
    }));
    return [];
  }

  return Array.from(new Set((data ?? []).map((row: Record<string, unknown>) => String(row.business_id)).filter(Boolean)));
}

async function businessesForUser(
  supabaseAdmin: any,
  user: { id: string; email?: string | null },
) {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id,name,owner_id,status,access_level,created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const byId = new Map<string, Record<string, unknown>>();
  for (const business of (data ?? []) as Array<Record<string, unknown>>) {
    byId.set(String(business.id), business);
  }

  const memberBusinessIds = (await businessMemberIdsForUser(supabaseAdmin, user)).filter((id) => !byId.has(id));
  if (memberBusinessIds.length) {
    const { data: memberBusinesses, error: memberBusinessError } = await supabaseAdmin
      .from("businesses")
      .select("id,name,owner_id,status,access_level,created_at")
      .in("id", memberBusinessIds)
      .order("created_at", { ascending: false });
    if (memberBusinessError) throw memberBusinessError;
    for (const business of (memberBusinesses ?? []) as Array<Record<string, unknown>>) {
      byId.set(String(business.id), business);
    }
  }

  return Array.from(byId.values()).sort((left, right) =>
    String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")),
  );
}

async function quotaUsageForBusiness(
  supabaseAdmin: any,
  business: Record<string, unknown>,
) {
  const monthStartIso = utcMonthStartIso();
  const usage = await Promise.all(
    AI_QUOTA_SCOPES.map(async (scope) => {
      const counted = await countAiQuotaUsage(supabaseAdmin, {
        businessId: String(business.id),
        scope,
        monthStartIso,
      });
      const limit = await quotaLimit(scope, supabaseAdmin, String(business.id));
      return {
        scope,
        used: counted.used,
        limit,
        remaining: Math.max(0, limit - counted.used),
        countSince: counted.countSinceIso,
        resetAt: counted.resetAt,
      };
    }),
  );

  return {
    id: business.id,
    name: business.name,
    owner_id: business.owner_id,
    status: business.status,
    access_level: business.access_level,
    usage,
  };
}

async function lookupUsage(req: Request, ctx: AdminContext, payload: Payload) {
  const targetUser = await resolveTargetUser(ctx.supabaseAdmin, payload);
  if (!targetUser) {
    return json(req, { ok: true, request_id: ctx.requestId, user: null, businesses: [] });
  }

  const businesses = await businessesForUser(ctx.supabaseAdmin, {
    id: targetUser.id,
    email: targetUser.email ?? null,
  });
  const businessUsage = await Promise.all(
    businesses.map((business: Record<string, unknown>) => quotaUsageForBusiness(ctx.supabaseAdmin, business)),
  );

  await ctx.supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: ctx.user.id,
    admin_email: ctx.adminUser.email ?? ctx.user.email ?? null,
    action: "admin_ai_quota_lookup",
    target_type: "ai_quota",
    target_id: targetUser.id,
    reason: "lookup",
    request_id: ctx.requestId,
  });

  return json(req, {
    ok: true,
    request_id: ctx.requestId,
    user: {
      id: targetUser.id,
      email: targetUser.email ?? null,
      created_at: targetUser.created_at ?? null,
    },
    businesses: businessUsage,
  });
}

async function resetQuota(req: Request, ctx: AdminContext, payload: Payload) {
  if (!canResetQuota(ctx.adminUser.role)) {
    return json(req, { error: "This admin role cannot reset AI quotas." }, 403);
  }

  const businessId = cleanString(payload.business_id);
  const scope = cleanString(payload.quota_scope) as AiQuotaScope;
  const reason = cleanString(payload.reason, 500) || "Admin monthly AI quota reset";
  if (!UUID_RE.test(businessId) || !isAiQuotaScope(scope)) {
    return json(req, { error: "Business and quota scope are required." }, 400);
  }

  const { data: business, error: businessError } = await ctx.supabaseAdmin
    .from("businesses")
    .select("id,name,owner_id,status,access_level")
    .eq("id", businessId)
    .maybeSingle();
  if (businessError) throw businessError;
  if (!business) {
    return json(req, { error: "Business not found." }, 404);
  }

  const monthStartIso = utcMonthStartIso();
  const before = await countAiQuotaUsage(ctx.supabaseAdmin, {
    businessId,
    scope,
    monthStartIso,
  });
  const owner = await authUserById(ctx.supabaseAdmin, String(business.owner_id));
  const limit = await quotaLimit(scope, ctx.supabaseAdmin, businessId);

  const { data: resetRow, error: resetError } = await ctx.supabaseAdmin
    .from("admin_ai_quota_resets")
    .insert({
      business_id: businessId,
      owner_user_id: business.owner_id,
      owner_email: owner?.email ?? null,
      quota_scope: scope,
      period_start: monthStartIso.slice(0, 10),
      reset_by: ctx.user.id,
      reason,
    })
    .select("id,reset_at")
    .single();
  if (resetError) throw resetError;

  const after = await countAiQuotaUsage(ctx.supabaseAdmin, {
    businessId,
    scope,
    monthStartIso,
  });

  await ctx.supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: ctx.user.id,
    admin_email: ctx.adminUser.email ?? ctx.user.email ?? null,
    action: "admin_ai_quota_reset",
    target_type: "ai_quota",
    target_id: resetRow.id,
    business_id: businessId,
    before_value: {
      scope,
      used: before.used,
      limit,
      count_since: before.countSinceIso,
      reset_at: before.resetAt,
    },
    after_value: {
      scope,
      used: after.used,
      limit,
      count_since: after.countSinceIso,
      reset_at: after.resetAt,
    },
    reason,
    request_id: ctx.requestId,
  });

  const updatedBusiness = await quotaUsageForBusiness(ctx.supabaseAdmin, business);
  return json(req, {
    ok: true,
    request_id: ctx.requestId,
    reset: {
      id: resetRow.id,
      business_id: businessId,
      scope,
      reset_at: resetRow.reset_at,
    },
    business: updatedBusiness,
  });
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
    const payload = await readPayload(req);
    const adminContext = await requireAdmin(req, requestId);
    if (adminContext instanceof Response) return adminContext;

    const action = cleanString(payload.action || "lookup", 40);
    if (action === "reset_quota") {
      // Must `await` inside the try: a bare `return resetQuota(...)` returns the
      // pending promise and the catch below never sees its rejection, so the
      // Deno runtime emits a bare 500 with no CORS headers (browser reports it
      // as an unreachable/network failure instead of the real error).
      return await resetQuota(req, adminContext, payload);
    }
    return await lookupUsage(req, adminContext, payload);
  } catch (err) {
    console.error("[admin-ai-usage] error:", err);
    return json(req, { error: "Failed to load AI usage.", request_id: requestId }, 500);
  }
});
