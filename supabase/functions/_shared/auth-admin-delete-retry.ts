type AuthAdminDeleteError = {
  name?: unknown;
  status?: unknown;
  code?: unknown;
};

type AuthAdminDeleteClient = {
  auth: {
    admin: {
      deleteUser: (userId: string) => Promise<{ error: unknown | null }>;
    };
  };
};

type DeleteAuthUserWithRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

export type DeleteAuthUserWithRetryResult = {
  error: unknown | null;
  attempts: number;
};

function asAuthAdminDeleteError(error: unknown): AuthAdminDeleteError | null {
  return typeof error === "object" && error !== null
    ? error as AuthAdminDeleteError
    : null;
}

/**
 * Retry only errors Supabase Auth identifies as transient.
 *
 * Production returned `AuthRetryableFetchError` with HTTP 500 during the final
 * account-delete call on 2026-07-27. A stale JWKS cache can also intermittently
 * return `403 bad_jwt` immediately after a project key rotation.
 */
export function isRetryableAuthAdminDeleteError(error: unknown): boolean {
  const authError = asAuthAdminDeleteError(error);
  if (!authError) return false;

  if (authError.name === "AuthRetryableFetchError") return true;
  return authError.status === 403 && authError.code === "bad_jwt";
}

function isAuthUserAlreadyDeletedError(error: unknown): boolean {
  const authError = asAuthAdminDeleteError(error);
  if (!authError) return false;
  return authError.status === 404 || authError.code === "user_not_found";
}

export async function deleteAuthUserWithRetry(
  client: AuthAdminDeleteClient,
  userId: string,
  {
    maxAttempts = 5,
    baseDelayMs = 300,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  }: DeleteAuthUserWithRetryOptions = {},
): Promise<DeleteAuthUserWithRetryResult> {
  const attemptsLimit = Math.max(1, Math.trunc(maxAttempts));
  let lastError: unknown | null = null;

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    try {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (!error) return { error: null, attempts: attempt };
      if (isAuthUserAlreadyDeletedError(error)) {
        return { error: null, attempts: attempt };
      }
      lastError = error;
    } catch (error) {
      if (isAuthUserAlreadyDeletedError(error)) {
        return { error: null, attempts: attempt };
      }
      lastError = error;
    }

    if (
      attempt === attemptsLimit ||
      !isRetryableAuthAdminDeleteError(lastError)
    ) {
      return { error: lastError, attempts: attempt };
    }

    await sleep(baseDelayMs * attempt);
  }

  return { error: lastError, attempts: attemptsLimit };
}
