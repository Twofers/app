import type { TFunction } from "i18next";

import { translateKnownApiMessage } from "@/lib/i18n/api-messages";

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

/** True when login failed only because the email is not confirmed yet. */
export function isEmailNotConfirmedError(error: AuthLikeError | undefined): boolean {
  if (!error) return false;
  return (
    lower(error.message ?? "").includes("email not confirmed") ||
    lower(error.code ?? "") === "email_not_confirmed"
  );
}

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
  if (m.includes("email not confirmed") || lower(code ?? "") === "email_not_confirmed") {
    return t("auth.errEmailNotConfirmed");
  }
  if (m.includes("invalid login credentials") || m.includes("invalid email or password")) {
    return t("auth.errInvalidCredentials");
  }
  if (m.includes("user not found")) {
    return t("auth.errInvalidCredentials");
  }
  if (m.includes("network")) {
    return t("auth.errNetwork");
  }
  // GoTrue's signup collision. It reached the user verbatim before the masking
  // fallback below existed, and it is genuinely actionable, so it needs a real
  // localized branch rather than being flattened into generic copy. (Password
  // length and email format are rejected client-side in app/auth-landing.tsx,
  // so they never arrive here.)
  if (m.includes("already registered") || m.includes("user already exists")) {
    return t("auth.errEmailAlreadyRegistered");
  }
  // Anything still unmatched is raw GoTrue / network / Postgres text, always in
  // English. Echoing it showed Spanish and Korean users an English sentence, so
  // hand it to the shared API-message translator: it maps the infra strings it
  // knows (JWT expired, RLS, network) and masks the rest with localized generic
  // copy. Empty input keeps the auth-specific generic message.
  const trimmed = raw?.trim();
  return trimmed ? translateKnownApiMessage(trimmed, t) : t("auth.errGeneric");
}
