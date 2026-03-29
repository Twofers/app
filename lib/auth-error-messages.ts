import type { TFunction } from "i18next";

function lower(raw: string): string {
  return (raw ?? "").toLowerCase();
}

/** Use for `{ data, error }` results from `supabase.auth.*` so HTTP status (e.g. 429) is respected. */
export function friendlyAuthError(
  error: { message?: string; status?: number } | null | undefined,
  t: TFunction,
): string {
  if (!error) return t("auth.errGeneric");
  if (error.status === 429) {
    return t("auth.errRateLimited");
  }
  return friendlyAuthMessage(error.message ?? "", t);
}

/** Maps Supabase / network auth errors to short, user-facing copy. */
export function friendlyAuthMessage(raw: string, t: TFunction): string {
  const m = lower(raw);
  if (m.includes("rate limit") || m.includes("too many requests") || m.includes("email rate")) {
    return t("auth.errRateLimited");
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
  return raw?.trim() ? raw : t("auth.errGeneric");
}

/** When demo password sign-in fails, prefer provisioning instructions over generic invalid password. */
export function friendlyDemoAuthMessage(raw: string, t: TFunction): string {
  const m = lower(raw);
  if (m.includes("rate limit") || m.includes("too many requests") || m.includes("email rate")) {
    return t("auth.errRateLimited");
  }
  if (
    m.includes("invalid login credentials") ||
    m.includes("invalid email or password") ||
    m.includes("user not found")
  ) {
    return t("auth.errDemoNotProvisioned");
  }
  return friendlyAuthMessage(raw, t);
}
