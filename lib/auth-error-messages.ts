import type { TFunction } from "i18next";

function lower(raw: string): string {
  return (raw ?? "").toLowerCase();
}

/** Supabase GoTrue uses messages/codes like `over_email_send_rate_limit` (no space "rate limit"). */
function isRateLimitedMessageOrCode(message: string, code?: string): boolean {
  const m = lower(message);
  const c = lower(code ?? "");
  if (m.includes("rate limit") || m.includes("too many requests") || m.includes("email rate")) {
    return true;
  }
  if (
    m.includes("over_email_send_rate_limit") ||
    m.includes("email_send_rate_limit") ||
    m.includes("email_rate_limit") ||
    m.includes("rate_limit")
  ) {
    return true;
  }
  if (
    c.includes("over_email_send_rate_limit") ||
    c.includes("email_send_rate_limit") ||
    c.includes("email_rate_limit") ||
    c.includes("rate_limit")
  ) {
    return true;
  }
  return false;
}

type AuthLikeError = {
  message?: string;
  status?: number;
  code?: string;
} | null;

/** Use for `{ data, error }` results from `supabase.auth.*` so HTTP status (e.g. 429) is respected. */
export function friendlyAuthError(error: AuthLikeError | undefined, t: TFunction): string {
  if (!error) return t("auth.errGeneric");
  if (error.status === 429) {
    return t("auth.errRateLimited");
  }
  const code = typeof error.code === "string" ? error.code : undefined;
  if (isRateLimitedMessageOrCode(error.message ?? "", code)) {
    return t("auth.errRateLimited");
  }
  return friendlyAuthMessage(error.message ?? "", t, code);
}

/** Maps Supabase / network auth errors to short, user-facing copy. */
export function friendlyAuthMessage(raw: string, t: TFunction, code?: string): string {
  if (isRateLimitedMessageOrCode(raw, code)) {
    return t("auth.errRateLimited");
  }
  const m = lower(raw);
  if (m.includes("invalid login credentials") || m.includes("invalid email or password")) {
    return t("auth.errInvalidCredentials");
  }
  if (m.includes("user not found")) {
    return t("auth.errInvalidCredentials");
  }
  if (m.includes("network")) {
    return t("auth.errNetwork");
  }
  return raw?.trim() ? raw : t("auth.errGeneric");
}

/** When demo password sign-in fails, prefer provisioning instructions over generic invalid password. */
export function friendlyDemoAuthMessage(raw: string, t: TFunction): string {
  if (isRateLimitedMessageOrCode(raw, undefined)) {
    return t("auth.errRateLimited");
  }
  const m = lower(raw);
  if (m.includes("invalid login credentials") || m.includes("invalid email or password") || m.includes("user not found")) {
    return t("auth.errDemoNotProvisioned");
  }
  return friendlyAuthMessage(raw, t);
}
