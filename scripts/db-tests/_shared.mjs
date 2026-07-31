// Shared helpers for the deliverable-2 database tests.
//
// These tests talk to a REMOTE Supabase project, so EVERY entry script must
// call assertTestDb() (from scripts/assert-test-db.mjs) as its first action,
// before any client or fetch. This module re-exports it for convenience, but
// each script still imports and calls it directly (belt and suspenders).
//
// Conventions mirror scripts/probe-rls-smoke.mjs and scripts/probe-strong-deal.mjs:
//   - plain Node + global fetch, no test framework, no supabase-js dependency
//   - env is read from a dotenv-style file (here: .env.test, NOT .env)
//   - a non-zero exit code means at least one check failed
//
// Credentials come from .env.test (gitignored):
//   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assertTestDb } from "../assert-test-db.mjs";

export { assertTestDb, randomUUID };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Read .env.test (only) into a plain object. Does NOT touch the network. */
export function loadTestEnv() {
  const file = path.join(REPO_ROOT, ".env.test");
  if (!existsSync(file)) {
    console.error(
      "\nMissing .env.test at repo root. Create it (gitignored) with:\n" +
        "  EXPO_PUBLIC_SUPABASE_URL=https://<test-ref>.supabase.co\n" +
        "  EXPO_PUBLIC_SUPABASE_ANON_KEY=...\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=...\n"
    );
    process.exit(2);
  }
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
  const url = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const anon = env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    console.error("\n.env.test is missing one of URL / ANON / SERVICE_ROLE_KEY.");
    process.exit(2);
  }
  return { url, anon, service };
}

// --- REST + auth helpers ----------------------------------------------------

/** PostgREST call. Returns { status, ok, json, text }. */
export async function rest(ctx, keyKind, pathAndQuery, init = {}) {
  const key = keyKind === "service" ? ctx.service : ctx.anon;
  const bearer = init.token ?? key; // user JWT when provided, else the key
  const res = await fetch(`${ctx.url}/rest/v1/${pathAndQuery}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Prefer: init.prefer ?? "return=representation",
      ...(init.headers ?? {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 300) };
}

/** Call an edge function. Returns { status, ok, json, text }. */
export async function fn(ctx, name, { token, body, method = "POST" } = {}) {
  const res = await fetch(`${ctx.url}/functions/v1/${name}`, {
    method,
    headers: {
      apikey: ctx.anon,
      Authorization: `Bearer ${token ?? ctx.anon}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 300) };
}

/** Password sign-in. Returns { token, userId } or throws. */
export async function signIn(ctx, email, password) {
  const res = await fetch(`${ctx.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ctx.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`sign-in failed (${res.status}): ${body.error_description ?? body.msg ?? "?"}`);
  }
  return { token: body.access_token, userId: body.user?.id };
}

/**
 * True for the transient `bad_jwt` GoTrue returns after a service-key rotation.
 *
 * Measured on the test project 2026-07-24, minutes after the key was rotated to
 * the `sb_secret_` format: 4 of 12 identical admin calls failed with
 * `403 bad_jwt / unrecognized JWT kid <nil> for algorithm ES256` while the other
 * 8 succeeded. The key is valid — some GoTrue instances were still serving a
 * stale JWKS cache, so calls failed depending on which one answered. Retrying
 * the same call succeeds. Without this the suites fail at random and look like
 * real RLS regressions.
 *
 * Deliberately narrow: only this signature is retried. A genuinely wrong key
 * fails every attempt and still surfaces as an error.
 */
function isTransientStaleKeyError(status, body) {
  return status === 403 && String(body?.error_code ?? "") === "bad_jwt";
}

async function adminFetchWithRetry(url, init, { tries = 5 } = {}) {
  let last = { status: 0, body: {} };
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: res.status, body };
    last = { status: res.status, body };
    if (!isTransientStaleKeyError(res.status, body)) break;
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return { ok: false, ...last };
}

/** Create a confirmed throwaway auth user via the admin API. Returns userId. */
export async function adminCreateUser(ctx, { email, password, role }) {
  const r = await adminFetchWithRetry(`${ctx.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: ctx.service, Authorization: `Bearer ${ctx.service}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: role ? { role } : undefined,
    }),
  });
  if (!r.ok || !r.body.id) {
    throw new Error(`admin createUser failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  return r.body.id;
}

/** Delete an auth user via the admin API. Best-effort. */
export async function adminDeleteUser(ctx, userId) {
  if (!userId) return;
  await adminFetchWithRetry(`${ctx.url}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: ctx.service, Authorization: `Bearer ${ctx.service}` },
  }).catch(() => {});
}

/** True if the admin API can still find the user (i.e. not deleted). */
export async function adminUserExists(ctx, userId) {
  const res = await fetch(`${ctx.url}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: ctx.service, Authorization: `Bearer ${ctx.service}` },
  });
  return res.status === 200;
}

export function uniqueEmail(tag) {
  return `zz-dbtest-${tag}-${randomUUID().slice(0, 8)}@twofer-tests.invalid`;
}

// --- tiny assertion harness -------------------------------------------------
// Not a framework — just a recorder so scripts can print PASS/FAIL and a
// bug-vs-test hint for any failure, then exit non-zero if anything failed.

export function makeReporter(suiteName) {
  const results = [];
  return {
    /**
     * @param {string} name        what is being checked
     * @param {boolean} passed      did it pass
     * @param {object} [opt]
     * @param {string} [opt.detail] extra context printed on any result
     * @param {string} [opt.onFail] what a failure means (bug-vs-test guidance)
     */
    check(name, passed, opt = {}) {
      results.push({ name, passed, ...opt });
      const tag = passed ? "PASS" : "FAIL";
      console.log(`  ${tag}  ${name}${opt.detail ? `  — ${opt.detail}` : ""}`);
      if (!passed && opt.onFail) console.log(`        ↳ if this fails: ${opt.onFail}`);
    },
    /** Record a skipped check (e.g. optional table absent). Not a failure. */
    skip(name, why) {
      results.push({ name, skipped: true, why });
      console.log(`  SKIP  ${name}${why ? `  — ${why}` : ""}`);
    },
    summary() {
      const failed = results.filter((r) => !r.passed && !r.skipped);
      const skipped = results.filter((r) => r.skipped);
      console.log(
        `\n[${suiteName}] ${results.length - skipped.length - failed.length} passed, ` +
          `${failed.length} failed, ${skipped.length} skipped`
      );
      return { failed: failed.length, results };
    },
  };
}

/** A PostgREST result counts as "denied" for RLS purposes. */
export function isDenied(r) {
  return r.status === 401 || r.status === 403 || /42501|permission denied|violates row-level security/i.test(r.text);
}
