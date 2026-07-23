import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { decodeJwtAal, verifiedTotpFactor } from "../_shared/admin-mfa.ts";
import { clientIpFromRequest } from "../_shared/client-ip.ts";

type AdminRole =
  | "owner"
  | "admin"
  | "support"
  | "sales"
  | "finance"
  | "moderator"
  | "developer"
  | "read_only";

type AuthPayload = {
  action?: unknown;
  email?: unknown;
  password?: unknown;
  refresh_token?: unknown;
  access_token?: unknown;
  factor_id?: unknown;
  code?: unknown;
};

type AdminRow = {
  id: string;
  email: string | null;
  role: AdminRole;
  is_active: boolean;
  require_mfa: boolean;
  display_name: string | null;
};

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
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

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readJson(req: Request): Promise<AuthPayload> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function passwordGrant(params: {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
}) {
  return fetch(`${params.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: params.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: params.email, password: params.password }),
  });
}

async function refreshGrant(params: {
  supabaseUrl: string;
  anonKey: string;
  refreshToken: string;
}) {
  return fetch(`${params.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: params.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: params.refreshToken }),
  });
}

async function enrollTotpFactor(params: { supabaseUrl: string; anonKey: string; accessToken: string }) {
  return fetch(`${params.supabaseUrl}/auth/v1/factors`, {
    method: "POST",
    headers: {
      apikey: params.anonKey,
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ factor_type: "totp", friendly_name: "Admin authenticator" }),
  });
}

async function challengeFactor(params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  factorId: string;
}) {
  return fetch(`${params.supabaseUrl}/auth/v1/factors/${params.factorId}/challenge`, {
    method: "POST",
    headers: {
      apikey: params.anonKey,
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
}

async function verifyFactor(params: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  factorId: string;
  challengeId: string;
  code: string;
}) {
  return fetch(`${params.supabaseUrl}/auth/v1/factors/${params.factorId}/verify`, {
    method: "POST",
    headers: {
      apikey: params.anonKey,
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ challenge_id: params.challengeId, code: params.code }),
  });
}

const LOGIN_RATE_LIMIT_WINDOW_MINUTES = 15;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 8;

async function recentFailedLoginCount(supabaseAdmin: any, email: string): Promise<number> {
  const windowStart = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("admin_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("admin_email", email)
    .in("action", ["admin_login_failed", "admin_login_denied"])
    .gte("created_at", windowStart);
  if (error) throw error;
  return count ?? 0;
}


async function resolveActiveAdmin(
  supabaseAdmin: any,
  userId: string,
): Promise<AdminRow | null> {
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .select("id,email,role,is_active,require_mfa,display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.is_active || !hasReadableAdminRole(data.role)) return null;
  return data as AdminRow;
}

function successBody(admin: AdminRow, session: Record<string, unknown>) {
  return {
    ok: true,
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      display_name: admin.display_name,
      require_mfa: admin.require_mfa,
    },
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
    },
  };
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(req, { error: "Admin login is not configured." }, 500);
    }

    const payload = await readJson(req);
    const action = cleanString(payload.action) || "password";
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const requestIp = clientIpFromRequest(req);

    if (action === "mfa_enroll" || action === "mfa_verify") {
      const accessToken = cleanString(payload.access_token);
      if (!accessToken) {
        return json(req, { error: "A valid sign-in session is required." }, 400);
      }

      const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      const {
        data: { user },
        error: userError,
      } = await supabaseUser.auth.getUser();
      if (userError || !user) {
        return json(req, { error: "Unauthorized." }, 401);
      }
      if (isRedeemerUser(user)) {
        return forbiddenForRedeemerResponse(corsHeaders);
      }

      const admin = await resolveActiveAdmin(supabaseAdmin, user.id);
      if (!admin) {
        return json(req, { error: "This account is not active in the admin allowlist." }, 403);
      }

      if (action === "mfa_enroll") {
        const enrollResponse = await enrollTotpFactor({ supabaseUrl, anonKey, accessToken });
        const enrolled = await enrollResponse.json().catch(() => ({}));
        if (!enrollResponse.ok || !enrolled?.id) {
          return json(req, { error: "Could not start MFA enrollment." }, 400);
        }
        return json(req, {
          ok: true,
          factor_id: enrolled.id,
          totp: {
            qr_code: enrolled.totp?.qr_code ?? null,
            secret: enrolled.totp?.secret ?? null,
            uri: enrolled.totp?.uri ?? null,
          },
        });
      }

      // action === "mfa_verify"
      const factorId = cleanString(payload.factor_id);
      const code = cleanString(payload.code);
      if (!factorId || !code) {
        return json(req, { error: "A verification code is required." }, 400);
      }

      const challengeResponse = await challengeFactor({ supabaseUrl, anonKey, accessToken, factorId });
      const challenge = await challengeResponse.json().catch(() => ({}));
      if (!challengeResponse.ok || !challenge?.id) {
        return json(req, { error: "Could not start MFA verification." }, 400);
      }

      const verifyResponse = await verifyFactor({
        supabaseUrl,
        anonKey,
        accessToken,
        factorId,
        challengeId: challenge.id,
        code,
      });
      const verified = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !verified?.access_token) {
        await supabaseAdmin.from("admin_audit_log").insert({
          admin_user_id: admin.id,
          admin_email: admin.email,
          action: "admin_mfa_verify_failed",
          target_type: "admin_login",
          reason: "invalid_code",
          ip_address: requestIp,
          user_agent: req.headers.get("user-agent"),
          request_id: requestId,
        });
        return json(req, { error: "Incorrect verification code." }, 401);
      }

      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: admin.id,
        admin_email: admin.email,
        action: "admin_mfa_verified",
        target_type: "admin_login",
        request_id: requestId,
      });

      return json(req, successBody(admin, verified));
    }

    // action === "password" (default: email+password or refresh_token grant)
    const email = cleanString(payload.email).toLowerCase();
    const password = typeof payload.password === "string" ? payload.password : "";
    const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
    const isRefresh = refreshToken.length > 0;

    if (!isRefresh && (!email || !password)) {
      return json(req, { error: "Email and password are required." }, 400);
    }

    if (!isRefresh) {
      const failedCount = await recentFailedLoginCount(supabaseAdmin, email);
      if (failedCount >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
        return json(req, { error: "Too many sign-in attempts. Please try again later." }, 429);
      }
    }

    const authResponse = isRefresh
      ? await refreshGrant({ supabaseUrl, anonKey, refreshToken })
      : await passwordGrant({ supabaseUrl, anonKey, email, password });

    const session = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok || !session?.access_token) {
      if (!isRefresh) {
        await supabaseAdmin.from("admin_audit_log").insert({
          admin_email: email || null,
          action: "admin_login_failed",
          target_type: "admin_login",
          reason: "invalid_credentials",
          ip_address: requestIp,
          user_agent: req.headers.get("user-agent"),
          request_id: requestId,
        });
      }
      return json(req, { error: "Invalid admin credentials." }, 401);
    }

    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return json(req, { error: "Unauthorized." }, 401);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    const adminUser = await resolveActiveAdmin(supabaseAdmin, user.id);
    if (!adminUser) {
      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: (user.email ?? email) || null,
        action: "admin_login_denied",
        target_type: "admin_login",
        reason: "not_active_admin",
        request_id: requestId,
      });
      return json(req, { error: "This account is not active in the admin allowlist." }, 403);
    }

    if (adminUser.require_mfa && decodeJwtAal(session.access_token) !== "aal2") {
      const factor = verifiedTotpFactor((user as { factors?: unknown }).factors);
      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: adminUser.id,
        admin_email: adminUser.email,
        action: isRefresh ? "admin_session_refreshed" : "admin_login_success",
        target_type: "admin_login",
        reason: factor ? "mfa_step_up_required" : "mfa_enrollment_required",
        request_id: requestId,
      });
      const sessionForMfa = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
      };
      if (factor) {
        return json(req, { ok: true, mfa_required: true, factor_id: factor.id, session: sessionForMfa });
      }
      return json(req, { ok: true, mfa_enrollment_required: true, session: sessionForMfa });
    }

    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: adminUser.id,
      admin_email: (adminUser.email ?? user.email ?? email) || null,
      action: isRefresh ? "admin_session_refreshed" : "admin_login_success",
      target_type: "admin_login",
      request_id: requestId,
    });

    return json(req, successBody(adminUser, session));
  } catch (err) {
    console.error("[admin-auth-session] error:", err);
    return json(req, { error: "Could not complete admin login.", request_id: requestId }, 500);
  }
});
