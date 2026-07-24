import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "./cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "./redemption-role.ts";
import { isAal2 } from "./admin-mfa.ts";
import { tryGetServiceRoleKey } from "./service-role-key.ts";

export type AdminRole =
  | "owner"
  | "admin"
  | "support"
  | "sales"
  | "finance"
  | "moderator"
  | "developer"
  | "read_only";

export type ProspectPermission =
  | "prospect.read"
  | "prospect.import"
  | "prospect.enrich"
  | "prospect.score"
  | "demand.read"
  | "sales.write"
  | "claim_link.write"
  | "trial.create"
  | "report.generate"
  | "prompt.manage"
  | "moderation.read"
  | "moderation.write"
  | "qr.read"
  | "qr.manage";

export type AdminContext = {
  user: { id: string; email?: string | null };
  adminUser: {
    id: string;
    email?: string | null;
    role: AdminRole;
    require_mfa?: boolean;
  };
  supabaseAdmin: any;
  requestId: string;
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

export async function readPayload(req: Request): Promise<Record<string, unknown>> {
  try {
    const payload = await req.json();
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function cleanString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export function nullableString(value: unknown, max = 500): string | null {
  const cleaned = cleanString(value, max);
  return cleaned || null;
}

export function cleanEmail(value: unknown): string {
  const email = cleanString(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function numberInRange(value: unknown, fallback: number | null, min: number, max: number): number | null {
  if (value == null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function hasReadableAdminRole(role: unknown): role is AdminRole {
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

export function roleCan(role: AdminRole, permission: ProspectPermission): boolean {
  if (role === "owner") return true;
  if (permission === "prospect.read" || permission === "demand.read") {
    return ["admin", "support", "sales", "finance", "moderator", "developer", "read_only"].includes(role);
  }
  if (permission === "report.generate") {
    return ["admin", "sales", "moderator", "developer"].includes(role);
  }
  if (permission === "prompt.manage") {
    return ["admin", "developer"].includes(role);
  }
  if (permission === "moderation.read") {
    return ["admin", "support", "moderator", "developer", "read_only"].includes(role);
  }
  if (permission === "moderation.write") {
    return ["admin", "moderator", "developer"].includes(role);
  }
  if (permission === "qr.read") {
    return ["admin", "support", "sales", "finance", "moderator", "developer", "read_only"].includes(role);
  }
  if (permission === "qr.manage") {
    return ["admin", "sales", "developer"].includes(role);
  }
  return ["admin", "sales", "moderator", "developer"].includes(role);
}

export async function requireAdmin(
  req: Request,
  requestId: string,
  permission: ProspectPermission,
): Promise<AdminContext | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = tryGetServiceRoleKey();
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Admin prospect services are not configured." }, 500);
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
    .select("id,email,role,is_active,require_mfa")
    .eq("id", user.id)
    .maybeSingle();

  if (adminError) throw adminError;
  if (!adminUser?.is_active || !hasReadableAdminRole(adminUser.role)) {
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: user.email ?? null,
      action: "admin_prospect_access_denied",
      target_type: "business_prospect",
      reason: "not_active_admin",
      request_id: requestId,
    });
    return json(req, { error: "Forbidden." }, 403);
  }

  if (adminUser.require_mfa && !isAal2(bearerToken)) {
    return json(req, { error: "MFA verification required." }, 403);
  }

  if (!roleCan(adminUser.role, permission)) {
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: adminUser.email ?? user.email ?? null,
      action: "admin_prospect_permission_denied",
      target_type: "business_prospect",
      reason: permission,
      request_id: requestId,
    });
    return json(req, { error: "This admin role cannot perform that action." }, 403);
  }

  return {
    user: { id: user.id, email: user.email },
    adminUser: {
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      require_mfa: adminUser.require_mfa,
    },
    supabaseAdmin,
    requestId,
  };
}

export async function audit(
  ctx: AdminContext,
  values: {
    action: string;
    targetType: string;
    targetId?: string | null;
    businessId?: string | null;
    beforeValue?: unknown;
    afterValue?: unknown;
    reason?: string | null;
  },
) {
  await ctx.supabaseAdmin.from("admin_audit_log").insert({
    admin_user_id: ctx.user.id,
    admin_email: ctx.adminUser.email ?? ctx.user.email ?? null,
    action: values.action,
    target_type: values.targetType,
    target_id: values.targetId ?? null,
    business_id: values.businessId ?? null,
    before_value: values.beforeValue ?? null,
    after_value: values.afterValue ?? null,
    reason: values.reason ?? null,
    request_id: ctx.requestId,
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomUrlToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
