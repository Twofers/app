/**
 * Resolves the credential used for service-role (admin) Supabase clients.
 *
 * The project migrated to asymmetric JWT signing keys (ES256). GoTrue now verifies
 * admin bearer tokens against the project JWKS, so the legacy `SUPABASE_SERVICE_ROLE_KEY`
 * — an HS256 JWT carrying no `kid` — is rejected on every `auth.admin.*` call with:
 *
 *   AuthApiError: invalid JWT: unrecognized JWT kid <nil> for algorithm ES256  (code "bad_jwt")
 *
 * PostgREST and Storage still accept the legacy key, which is why only the Auth admin
 * API broke and the failure went unnoticed for weeks.
 *
 * `PROJECT_SERVICE_ROLE_KEY` holds the new-format `sb_secret_...` key. Prefer it and fall
 * back to the legacy name so functions deployed before the secret is set keep working —
 * the fallback is only correct for database/storage work, never for `auth.admin.*`.
 */

function readEnv(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value && value.trim().length > 0 ? value : undefined;
}

/** Non-throwing variant, for callers that already return their own "not configured" response. */
export function tryGetServiceRoleKey(): string | undefined {
  return readEnv("PROJECT_SERVICE_ROLE_KEY") ?? readEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function getServiceRoleKey(): string {
  const key = tryGetServiceRoleKey();
  if (!key) {
    throw new Error(
      "No service-role key configured: set PROJECT_SERVICE_ROLE_KEY (sb_secret_...) or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return key;
}
