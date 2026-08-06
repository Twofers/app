import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { decodeJwtAal, verifiedTotpFactor } from "../_shared/admin-mfa.ts";
import { founderAdminUserId, isFounderAdminUser } from "../_shared/admin-founder.ts";
import { sendAdminSecurityAlert } from "../_shared/admin-security-alert.ts";
import { clientIpFromRequest } from "../_shared/client-ip.ts";
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

type AuthPayload = {
  action?: unknown;
  email?: unknown;
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

// Founder sign-in is passwordless. Instead of a password grant we mint the
// pre-MFA (aal1) session with the service-role key: generate a one-time
// magiclink token for the address, then redeem it. `generate_link` only
// returns the token — it sends no email — and the token is single-use. The
// resulting session is aal1 and is worthless to the caller until the TOTP
// step-up below succeeds, so possession of the authenticator remains the only
// thing that actually grants admin access.
async function adminGenerateMagicLink(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  email: string;
}) {
  return fetch(`${params.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: params.serviceRoleKey,
      Authorization: `Bearer ${params.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: params.email }),
  });
}

async function redeemMagicLink(params: {
  supabaseUrl: string;
  anonKey: string;
  tokenHash: string;
}) {
  return fetch(`${params.supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: params.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", token_hash: params.tokenHash }),
  });
}

// Same one-time grant, addressed by the raw OTP instead of the hashed handle.
// `generate_link` returns both; only this one is independent of whether the
// project runs the PKCE flow (which prefixes `hashed_token` with `pkce_`).
async function redeemEmailOtp(params: {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  token: string;
}) {
  return fetch(`${params.supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: params.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: params.email, token: params.token }),
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

// Best-effort teardown of the aal1 session minted during a sign-in that never
// reached aal2, so a rejected code leaves no live session behind.
async function revokeSession(params: { supabaseUrl: string; anonKey: string; accessToken: string }) {
  try {
    await fetch(`${params.supabaseUrl}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: {
        apikey: params.anonKey,
        Authorization: `Bearer ${params.accessToken}`,
      },
    });
  } catch {
    // A stranded aal1 session is never handed to the caller; ignore.
  }
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
  if (
    !data?.is_active ||
    data.require_mfa !== true ||
    !isFounderAdminUser(userId, data.role)
  ) return null;
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
    const serviceRoleKey = tryGetServiceRoleKey();
    const founderId = founderAdminUserId();

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !founderId) {
      return json(req, { error: "Founder admin login is not configured." }, 500);
    }

    const payload = await readJson(req);
    const action = cleanString(payload.action) || "signin";
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
      await sendAdminSecurityAlert({
        event: "admin_mfa_verified",
        adminEmail: admin.email,
        targetId: admin.id,
        requestId,
      });

      return json(req, successBody(admin, verified));
    }

    // action === "signin" (default: admin email + authenticator code, or a
    // refresh_token grant for an already-established session)
    const email = cleanString(payload.email).toLowerCase();
    const code = cleanString(payload.code);
    const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
    const isRefresh = refreshToken.length > 0;

    if (!isRefresh && (!email || !code)) {
      return json(req, { error: "Admin email and authenticator code are required." }, 400);
    }

    // Rate-limit before touching the Auth admin API, so a stranger with the
    // founder address cannot make us mint magiclink tokens in a loop.
    if (!isRefresh) {
      const failedCount = await recentFailedLoginCount(supabaseAdmin, email);
      if (failedCount >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
        return json(req, { error: "Too many sign-in attempts. Please try again later." }, 429);
      }
    }

    // deno-lint-ignore no-explicit-any
    let session: any = {};
    let authOk = false;
    let mintDetail = "";

    if (isRefresh) {
      const refreshResponse = await refreshGrant({ supabaseUrl, anonKey, refreshToken });
      session = await refreshResponse.json().catch(() => ({}));
      authOk = refreshResponse.ok && typeof session?.access_token === "string";
    } else {
      const linkResponse = await adminGenerateMagicLink({ supabaseUrl, serviceRoleKey, email });
      const link = await linkResponse.json().catch(() => ({}));
      const tokenHash = typeof link?.hashed_token === "string" ? link.hashed_token : "";
      const emailOtp = typeof link?.email_otp === "string" ? link.email_otp : "";
      if (!linkResponse.ok || (!tokenHash && !emailOtp)) {
        // Distinguish "no such user" (expected, generic 401 below) from an
        // Auth-configuration problem, which is otherwise near-impossible to
        // diagnose from the browser.
        console.error(
          "[admin-auth-session] generate_link failed:",
          linkResponse.status,
          JSON.stringify(link),
        );
        await supabaseAdmin.from("admin_audit_log").insert({
          admin_email: email || null,
          action: "admin_login_failed",
          target_type: "admin_login",
          reason: "magiclink_unavailable",
          ip_address: requestIp,
          user_agent: req.headers.get("user-agent"),
          request_id: requestId,
        });
        return json(
          req,
          { error: "Invalid admin credentials.", reason: "magiclink_unavailable" },
          401,
        );
      }
      // Redeem the one-time grant. Try the hashed handle first, then the raw
      // OTP, so the flow works whether or not the project runs PKCE. Neither
      // token value is ever logged — only the upstream status and error code.
      if (tokenHash) {
        const hashResponse = await redeemMagicLink({ supabaseUrl, anonKey, tokenHash });
        session = await hashResponse.json().catch(() => ({}));
        authOk = hashResponse.ok && typeof session?.access_token === "string";
        if (!authOk) {
          mintDetail = `token_hash=${hashResponse.status}/${session?.error_code ?? "?"}`;
        }
      }
      if (!authOk && emailOtp) {
        const otpResponse = await redeemEmailOtp({ supabaseUrl, anonKey, email, token: emailOtp });
        session = await otpResponse.json().catch(() => ({}));
        authOk = otpResponse.ok && typeof session?.access_token === "string";
        if (!authOk) {
          mintDetail = `${mintDetail} email_otp=${otpResponse.status}/${session?.error_code ?? "?"}`.trim();
        }
      }
      if (!authOk) {
        console.error("[admin-auth-session] session mint failed:", mintDetail);
      }
    }

    if (!authOk) {
      if (!isRefresh) {
        await supabaseAdmin.from("admin_audit_log").insert({
          admin_email: email || null,
          action: "admin_login_failed",
          target_type: "admin_login",
          reason: "session_mint_failed",
          ip_address: requestIp,
          user_agent: req.headers.get("user-agent"),
          request_id: requestId,
        });
      }
      return json(req, { error: "Invalid admin credentials.", reason: mintDetail || undefined }, 401);
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

    if (decodeJwtAal(session.access_token) !== "aal2") {
      const factor = verifiedTotpFactor((user as { factors?: unknown }).factors);

      // A refresh grant carries no code to check, and a founder with no
      // verified factor yet has to enroll one before any code can exist. Both
      // hand the aal1 session back so the browser can finish the MFA step.
      if (isRefresh || !factor) {
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

      // Single-step sign-in: the authenticator code arrived with the request,
      // so step up here and only ever hand back an aal2 session. A wrong code
      // logs `admin_login_failed`, which feeds the same rate limiter as a bad
      // sign-in, and leaks no aal1 session to the caller.
      const challengeResponse = await challengeFactor({
        supabaseUrl,
        anonKey,
        accessToken: session.access_token,
        factorId: factor.id,
      });
      const challenge = await challengeResponse.json().catch(() => ({}));
      if (!challengeResponse.ok || !challenge?.id) {
        await revokeSession({ supabaseUrl, anonKey, accessToken: session.access_token });
        return json(req, { error: "Could not start MFA verification." }, 400);
      }

      const verified = await verifyFactor({
        supabaseUrl,
        anonKey,
        accessToken: session.access_token,
        factorId: factor.id,
        challengeId: challenge.id,
        code,
      }).then((response) => response.json().catch(() => ({})), () => ({}));

      if (!verified?.access_token || decodeJwtAal(verified.access_token) !== "aal2") {
        await revokeSession({ supabaseUrl, anonKey, accessToken: session.access_token });
        await supabaseAdmin.from("admin_audit_log").insert({
          admin_user_id: adminUser.id,
          // Logged under the submitted address so `recentFailedLoginCount`
          // (which keys on it) counts wrong codes toward the same limit.
          admin_email: email,
          action: "admin_login_failed",
          target_type: "admin_login",
          reason: "invalid_totp_code",
          ip_address: requestIp,
          user_agent: req.headers.get("user-agent"),
          request_id: requestId,
        });
        return json(req, { error: "Incorrect verification code." }, 401);
      }

      session = verified;
    }

    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: adminUser.id,
      admin_email: (adminUser.email ?? user.email ?? email) || null,
      action: isRefresh ? "admin_session_refreshed" : "admin_login_success",
      target_type: "admin_login",
      request_id: requestId,
    });
    if (!isRefresh) {
      await sendAdminSecurityAlert({
        event: "admin_login_success",
        adminEmail: adminUser.email ?? user.email,
        targetId: adminUser.id,
        requestId,
      });
    }

    return json(req, successBody(adminUser, session));
  } catch (err) {
    console.error("[admin-auth-session] error:", err);
    return json(req, { error: "Could not complete admin login.", request_id: requestId }, 500);
  }
});
