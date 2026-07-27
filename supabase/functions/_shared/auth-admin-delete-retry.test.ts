import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deleteAuthUserWithRetry,
  isRetryableAuthAdminDeleteError,
} from "./auth-admin-delete-retry";

function clientWithDelete(
  deleteUser: (userId: string) => Promise<{ error: unknown | null }>,
) {
  return { auth: { admin: { deleteUser } } };
}

describe("auth admin delete retry", () => {
  it("recognizes only transient Supabase Auth failures", () => {
    expect(
      isRetryableAuthAdminDeleteError({
        name: "AuthRetryableFetchError",
        status: 500,
      }),
    ).toBe(true);
    expect(
      isRetryableAuthAdminDeleteError({
        name: "AuthApiError",
        status: 403,
        code: "bad_jwt",
      }),
    ).toBe(true);
    expect(
      isRetryableAuthAdminDeleteError({
        name: "AuthApiError",
        status: 500,
        code: "unexpected_failure",
      }),
    ).toBe(false);
  });

  it("returns immediately when the first delete succeeds", async () => {
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const sleep = vi.fn();

    const result = await deleteAuthUserWithRetry(
      clientWithDelete(deleteUser),
      "owner-id",
      { sleep },
    );

    expect(result).toEqual({ error: null, attempts: 1 });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries AuthRetryableFetchError with bounded backoff", async () => {
    const transientError = {
      name: "AuthRetryableFetchError",
      status: 500,
    };
    const deleteUser = vi
      .fn()
      .mockResolvedValueOnce({ error: transientError })
      .mockResolvedValueOnce({ error: transientError })
      .mockResolvedValueOnce({ error: null });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await deleteAuthUserWithRetry(
      clientWithDelete(deleteUser),
      "owner-id",
      { baseDelayMs: 300, sleep },
    );

    expect(result).toEqual({ error: null, attempts: 3 });
    expect(deleteUser).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[300], [600]]);
  });

  it("does not retry a deterministic Auth API error", async () => {
    const fatalError = {
      name: "AuthApiError",
      status: 400,
      code: "validation_failed",
    };
    const deleteUser = vi.fn().mockResolvedValue({ error: fatalError });
    const sleep = vi.fn();

    const result = await deleteAuthUserWithRetry(
      clientWithDelete(deleteUser),
      "owner-id",
      { sleep },
    );

    expect(result).toEqual({ error: fatalError, attempts: 1 });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("treats user-not-found after a transient response as deleted", async () => {
    const deleteUser = vi
      .fn()
      .mockResolvedValueOnce({
        error: { name: "AuthRetryableFetchError", status: 500 },
      })
      .mockResolvedValueOnce({
        error: { name: "AuthApiError", status: 404, code: "user_not_found" },
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await deleteAuthUserWithRetry(
      clientWithDelete(deleteUser),
      "owner-id",
      { sleep },
    );

    expect(result).toEqual({ error: null, attempts: 2 });
    expect(deleteUser).toHaveBeenCalledTimes(2);
  });

  it("returns the last transient error after exhausting attempts", async () => {
    const transientError = {
      name: "AuthRetryableFetchError",
      status: 500,
    };
    const deleteUser = vi.fn().mockResolvedValue({ error: transientError });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await deleteAuthUserWithRetry(
      clientWithDelete(deleteUser),
      "owner-id",
      { maxAttempts: 3, baseDelayMs: 100, sleep },
    );

    expect(result).toEqual({ error: transientError, attempts: 3 });
    expect(deleteUser).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it("keeps every account-deletion Auth removal on the retry helper", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "supabase",
        "functions",
        "delete-user-account",
        "index.ts",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/auth\.admin\.deleteUser\(/);
    expect(source.match(/deleteAuthUserWithRetry\(/g)).toHaveLength(2);
  });
});
