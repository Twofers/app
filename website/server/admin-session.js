const crypto = require("node:crypto");

const COOKIE_NAME = "__Host-twofer_admin_session";
const MAX_COOKIE_AGE_SECONDS = 60 * 60 * 8;
const MAX_SESSION_AGE_MS = MAX_COOKIE_AGE_SECONDS * 1000;

function baseUrl() {
  const configured = String(process.env.SUPABASE_FUNCTIONS_BASE_URL || "").replace(/\/+$/, "");
  if (configured) return configured;
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured.");
  return `${supabaseUrl}/functions/v1`;
}

function encryptionKey() {
  const value = String(process.env.ADMIN_SESSION_ENCRYPTION_KEY || "");
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32) {
    throw new Error("ADMIN_SESSION_ENCRYPTION_KEY must be 32 random base64url bytes.");
  }
  return key;
}

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function unseal(value) {
  try {
    const bytes = Buffer.from(String(value || ""), "base64url");
    if (bytes.length < 29) return null;
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const ciphertext = bytes.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    return null;
  }
}

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator < 0
          ? [part, ""]
          : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function readState(req) {
  return unseal(cookies(req)[COOKIE_NAME]);
}

function cookie(value, maxAge = MAX_COOKIE_AGE_SECONDS) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function setState(res, state) {
  const secondsRemaining = Math.min(
    MAX_COOKIE_AGE_SECONDS,
    Math.max(0, Math.ceil((Number(state?.absolute_expires_at) - Date.now()) / 1000)),
  );
  if (!secondsRemaining) {
    clearState(res);
    return;
  }
  res.setHeader("Set-Cookie", cookie(seal(state), secondsRemaining));
}

function clearState(res) {
  res.setHeader("Set-Cookie", cookie("", 0));
}

function sameOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return false;
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "https");
  return origin === `${forwardedProto}://${forwardedHost}`;
}

async function edgeFunction(name, body, accessToken) {
  const response = await fetch(`${baseUrl()}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function sessionState(session, extra = {}) {
  if (!session?.access_token || !session?.refresh_token) {
    throw new Error("Admin auth response did not include a complete session.");
  }
  const now = Date.now();
  const issuedAt = Number(extra.issued_at) || now;
  const absoluteExpiresAt = Number(extra.absolute_expires_at) || issuedAt + MAX_SESSION_AGE_MS;
  return {
    ...extra,
    version: 1,
    issued_at: issuedAt,
    absolute_expires_at: absoluteExpiresAt,
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: now + Math.max(60, Number(session.expires_in) || 3600) * 1000,
    },
  };
}

async function activeState(req, res) {
  let state = readState(req);
  if (
    state?.version !== 1 ||
    !state?.session?.access_token ||
    state.pending === true ||
    !Number.isFinite(Number(state.absolute_expires_at)) ||
    Number(state.absolute_expires_at) <= Date.now()
  ) {
    if (state) clearState(res);
    return null;
  }
  if (Number(state.session.expires_at || 0) - Date.now() > 60_000) return state;

  const { response, payload } = await edgeFunction("admin-auth-session", {
    refresh_token: state.session.refresh_token,
  });
  if (
    !response.ok ||
    !payload?.ok ||
    payload.mfa_required === true ||
    payload.mfa_enrollment_required === true ||
    !payload?.session?.access_token
  ) {
    clearState(res);
    return null;
  }
  state = sessionState(payload.session, {
    issued_at: state.issued_at,
    absolute_expires_at: state.absolute_expires_at,
  });
  setState(res, state);
  return state;
}

module.exports = {
  activeState,
  clearState,
  edgeFunction,
  readState,
  sameOrigin,
  sessionState,
  setState,
};
