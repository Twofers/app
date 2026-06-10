// READ-ONLY prod schema probe (same .env/anon-key pattern as probe-strong-deal.mjs).
//
// Q1: what columns does app_analytics_events actually have in prod?
//     PostgREST's OpenAPI document reflects the live schema cache.
// Q2: does public.purge_user_data exist?
//     Probed by HTTP status of an rpc POST that is NEVER executed with a real
//     payload — we use an invalid (non-uuid) argument so Postgres rejects the
//     call at parse/cast time even if permissions allowed it. anon lacks
//     EXECUTE anyway (REVOKE FROM PUBLIC), so the expected outcomes are:
//       404 → function not in schema cache (missing or not exposed)
//       401/403/42501 → function exists, permission denied (expected)
//
// Run:  node scripts/probe-analytics-schema.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  const text = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return env;
}
const env = loadEnv();
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_BASE || !ANON) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

// --- Q1: columns of app_analytics_events via the OpenAPI schema document ---
const specRes = await fetch(`${URL_BASE}/rest/v1/`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
});
if (!specRes.ok) {
  console.error(`OpenAPI fetch failed: HTTP ${specRes.status}`);
} else {
  const spec = await specRes.json();
  const def = spec.definitions?.app_analytics_events;
  if (!def) {
    console.log("Q1: app_analytics_events NOT in PostgREST schema cache (no anon-visible definition).");
  } else {
    console.log("Q1: app_analytics_events columns in prod (per PostgREST schema):");
    for (const [col, meta] of Object.entries(def.properties ?? {})) {
      console.log(`  ${col}  (${meta.format ?? meta.type})`);
    }
    const hasSession = Object.hasOwn(def.properties ?? {}, "session_id");
    console.log(`  => session_id column present: ${hasSession}`);
  }
}

// --- Q1 fallback: per-column select probes (read-only; limit=0 so no rows move) ---
async function probeColumn(col) {
  const res = await fetch(
    `${URL_BASE}/rest/v1/app_analytics_events?select=${col}&limit=0`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
  );
  const body = (await res.text()).slice(0, 200);
  return { status: res.status, body };
}
for (const col of ["user_id", "session_id"]) {
  const r = await probeColumn(col);
  console.log(`\nQ1-probe select=${col} → HTTP ${r.status}: ${r.body}`);
}

// --- Q2: does purge_user_data exist? (never executed: invalid arg + no EXECUTE grant) ---
const rpcRes = await fetch(`${URL_BASE}/rest/v1/rpc/purge_user_data`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ p_user_id: "not-a-uuid" }),
});
const rpcBody = (await rpcRes.text()).slice(0, 300);
console.log(`\nQ2: rpc/purge_user_data probe → HTTP ${rpcRes.status}`);
console.log(`  body: ${rpcBody}`);
if (rpcRes.status === 404) {
  console.log("  => function NOT visible to PostgREST (likely missing in prod, or migration never applied).");
} else {
  console.log("  => function EXISTS in prod (permission/validation error is the expected response).");
}
console.log("\nNote: the full pg_get_functiondef output (your query #2) cannot be read through");
console.log("PostgREST; run it in the Supabase SQL editor to see the deployed definition.");
