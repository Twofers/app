// READ-ONLY edge-function smoke probe (same .env/anon-key pattern as
// probe-analytics-schema.mjs).
//
// For each function name passed on the command line, sends a POST with the
// anon apikey but NO user JWT and an empty JSON body. Every probed function
// authenticates the caller before doing any work, so the request is rejected
// without side effects. Outcomes:
//   401/400/403 → function is deployed, booting, and responding (HEALTHY)
//   404         → function not deployed / not routable (UNHEALTHY)
//   5xx         → function deployed but crashing on boot (UNHEALTHY)
//
// Run:  node scripts/probe-edge-functions-smoke.mjs <fn> [<fn> ...]

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

const fns = process.argv.slice(2);
if (fns.length === 0) {
  console.error("Usage: node scripts/probe-edge-functions-smoke.mjs <fn> [<fn> ...]");
  process.exit(1);
}

let unhealthy = 0;
for (const fn of fns) {
  const started = Date.now();
  let status = "ERR";
  let body = "";
  try {
    const res = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: "{}",
    });
    status = res.status;
    body = (await res.text()).slice(0, 160).replace(/\s+/g, " ");
  } catch (e) {
    body = String(e).slice(0, 160);
  }
  const ms = Date.now() - started;
  const healthy = typeof status === "number" && status >= 400 && status < 500 && status !== 404;
  if (!healthy) unhealthy++;
  console.log(`${healthy ? "HEALTHY  " : "UNHEALTHY"}  ${fn}  HTTP ${status} (${ms}ms)  ${body}`);
}
process.exit(unhealthy === 0 ? 0 : 1);
