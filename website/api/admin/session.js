const {
  activeState,
  clearState,
  edgeFunction,
  readState,
  sameOrigin,
  sessionState,
  setState,
} = require("../../server/admin-session");

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const state = await activeState(req, res);
    return send(res, 200, {
      ok: true,
      authenticated: Boolean(state),
      pending_mfa: Boolean(readState(req)?.pending),
    });
  }

  if (req.method === "DELETE") {
    if (!sameOrigin(req)) return send(res, 403, { error: "Invalid request origin." });
    clearState(res);
    return send(res, 200, { ok: true });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });
  if (!sameOrigin(req)) return send(res, 403, { error: "Invalid request origin." });

  const action = String(req.body?.action || "signin");
  if (action === "signin") {
    // Admin email + authenticator code. No password is collected here or sent
    // upstream; the founder's Supabase password lives only in the edge
    // function's environment.
    const { response, payload } = await edgeFunction("admin-auth-session", {
      action: "signin",
      email: req.body?.email,
      code: req.body?.code,
    });
    if (!response.ok || !payload?.ok) {
      return send(res, response.status, { error: payload?.error || "Sign in failed." });
    }
    if (payload.mfa_enrollment_required || payload.mfa_required) {
      setState(res, sessionState(payload.session, {
        pending: true,
        factor_id: payload.factor_id || null,
      }));
      return send(res, 200, {
        ok: true,
        mfa_enrollment_required: payload.mfa_enrollment_required === true,
        mfa_required: payload.mfa_required === true,
        factor_id: payload.factor_id || null,
      });
    }
    // A fresh sign-in that already satisfies MFA issues a NEW session on
    // a fresh clock. (Previously this read `pending.*` before its declaration
    // below — a temporal-dead-zone ReferenceError, and semantically wrong since
    // no pending state exists on a fresh login. Web-attack review 2026-07-31, F4.)
    setState(res, sessionState(payload.session));
    return send(res, 200, { ok: true, authenticated: true });
  }

  const pending = readState(req);
  if (!pending?.pending || !pending?.session?.access_token) {
    clearState(res);
    return send(res, 401, { error: "Restart admin sign-in." });
  }

  if (action === "mfa_enroll") {
    const { response, payload } = await edgeFunction("admin-auth-session", {
      action,
      access_token: pending.session.access_token,
    });
    if (!response.ok || !payload?.ok) {
      return send(res, response.status, { error: payload?.error || "Could not start MFA enrollment." });
    }
    pending.factor_id = payload.factor_id;
    setState(res, pending);
    return send(res, 200, {
      ok: true,
      factor_id: payload.factor_id,
      totp: payload.totp,
    });
  }

  if (action === "mfa_verify") {
    const factorId = String(pending.factor_id || req.body?.factor_id || "");
    const { response, payload } = await edgeFunction("admin-auth-session", {
      action,
      access_token: pending.session.access_token,
      factor_id: factorId,
      code: req.body?.code,
    });
    if (!response.ok || !payload?.ok || !payload?.session?.access_token) {
      return send(res, response.status, { error: payload?.error || "Incorrect verification code." });
    }
    setState(res, sessionState(payload.session));
    return send(res, 200, { ok: true, authenticated: true });
  }

  return send(res, 400, { error: "Unknown admin session action." });
};
