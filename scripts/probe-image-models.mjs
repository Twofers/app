// Diagnostic: probe which OpenAI image models this account can actually call RIGHT NOW.
//
// Safe by design:
//   - Reads OPENAI_API_KEY from process.env first, then the gitignored supabase/.env, then .env.
//   - NEVER prints, logs, or writes the key. Only prints HTTP status, error type/message,
//     and the (non-secret) `openai-organization` response header.
//   - Makes a real images/generations call per model (the only way to prove access).
//
// Run:  node scripts/probe-image-models.mjs
// Or:   $env:OPENAI_API_KEY="sk-..."; node scripts/probe-image-models.mjs   (PowerShell)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MODELS = ["gpt-image-2", "gpt-image-1", "gpt-image-1-mini"];
const PROMPT = "A single cup of coffee on a light wooden cafe table, soft daylight, simple product photo.";
const SIZE = "1024x1024";
const TIMEOUT_MS = 90_000;

/** Read OPENAI_API_KEY from env or a gitignored dotenv file. Returns {key, source} or null. */
function loadKey() {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    return { key: process.env.OPENAI_API_KEY.trim(), source: "process.env.OPENAI_API_KEY" };
  }
  for (const rel of ["supabase/.env", ".env"]) {
    try {
      const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+)\s*$/);
        if (m) {
          let v = m[1].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (v) return { key: v, source: rel };
        }
      }
    } catch {
      // file not present — try next
    }
  }
  return null;
}

/** Classify the key TYPE without revealing any characters of it. */
function keyKind(key) {
  if (key.startsWith("sk-proj-")) return "project-scoped key (sk-proj-…) — belongs to exactly one project in one org";
  if (key.startsWith("sk-svcacct-")) return "service-account key (sk-svcacct-…) — scoped to one project in one org";
  if (key.startsWith("sk-")) return "legacy/user key (sk-…) — may span multiple orgs; uses the account default org";
  return "unrecognized key format";
}

async function probe(model, key) {
  const started = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // Minimal valid GPT-image request — no quality/response_format so a param quirk can't
      // masquerade as an access error. Access (verified / model exists / permissions) is
      // decided before generation regardless of these.
      body: JSON.stringify({ model, prompt: PROMPT, n: 1, size: SIZE }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    const org = res.headers.get("openai-organization") || "(none returned)";
    const reqId = res.headers.get("x-request-id") || "(none)";

    if (res.ok) {
      const j = await res.json();
      const row = j?.data?.[0] || {};
      const b64len = typeof row.b64_json === "string" ? row.b64_json.length : 0;
      const hasUrl = typeof row.url === "string" && row.url.length > 0;
      const approxBytes = b64len ? Math.floor(b64len * 0.75) : 0;
      return {
        model, ms, status: res.status, ok: true, org, reqId,
        result: b64len
          ? `IMAGE RETURNED (~${approxBytes} bytes of PNG data)`
          : hasUrl ? "IMAGE RETURNED (as URL)" : "200 OK but no image data in payload",
      };
    }

    // Non-OK: capture the exact error type/code/message (this is what the user wants verbatim).
    let errType = "", errCode = "", errMsg = "", raw = "";
    try {
      const j = await res.json();
      errType = j?.error?.type || "";
      errCode = j?.error?.code || "";
      errMsg = j?.error?.message || "";
      raw = JSON.stringify(j).slice(0, 600);
    } catch {
      raw = (await res.text().catch(() => "")).slice(0, 600);
    }
    return { model, ms, status: res.status, ok: false, org, reqId, errType, errCode, errMsg, raw };
  } catch (e) {
    return {
      model, ms: Date.now() - started, status: 0, ok: false,
      org: "(no response)", reqId: "(none)",
      errType: e?.name || "NetworkError",
      errMsg: String(e?.message || e).slice(0, 300),
    };
  }
}

async function main() {
  const loaded = loadKey();
  console.log("=".repeat(72));
  console.log("OpenAI image-model access probe");
  console.log("Date:", new Date().toISOString());
  console.log("=".repeat(72));

  if (!loaded) {
    console.log("\nNO OPENAI_API_KEY FOUND.");
    console.log("Provide it one of these ways (the key is never printed or committed):");
    console.log("  A) PowerShell:  $env:OPENAI_API_KEY=\"sk-...\"; node scripts/probe-image-models.mjs");
    console.log("  B) Paste it after OPENAI_API_KEY= in the gitignored file supabase/.env, then re-run.");
    process.exitCode = 2;
    return;
  }

  console.log("\nKey source :", loaded.source);
  console.log("Key type   :", keyKind(loaded.key));
  console.log("(The key value itself is never printed.)\n");

  const results = [];
  for (const model of MODELS) {
    process.stdout.write(`Testing ${model} … `);
    const r = await probe(model, loaded.key);
    console.log(`${r.status || "ERR"} (${r.ms} ms)`);
    results.push(r);
  }

  console.log("\n" + "=".repeat(72));
  console.log("RESULTS");
  console.log("=".repeat(72));
  for (const r of results) {
    console.log(`\n── ${r.model} ──`);
    console.log(`   HTTP status : ${r.status}`);
    console.log(`   org (header): ${r.org}`);
    console.log(`   request id  : ${r.reqId}`);
    if (r.ok) {
      console.log(`   OUTCOME     : ✅ ${r.result}`);
    } else {
      console.log(`   OUTCOME     : ❌ FAILED`);
      if (r.errType) console.log(`   error.type  : ${r.errType}`);
      if (r.errCode) console.log(`   error.code  : ${r.errCode}`);
      if (r.errMsg) console.log(`   error.msg   : ${r.errMsg}`);
      if (!r.errType && !r.errMsg && r.raw) console.log(`   raw         : ${r.raw}`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("ONE-LINE SUMMARY");
  console.log("=".repeat(72));
  for (const r of results) {
    const verdict = r.ok
      ? "USABLE NOW"
      : r.status === 403 || /must be verified|verify/i.test(r.errMsg || "")
        ? "blocked — verification/permissions"
        : r.status === 404 || r.errCode === "model_not_found" || /does not exist|not found|unknown model/i.test(r.errMsg || "")
          ? "model not found for this account"
          : r.status === 429
            ? "rate-limited / quota"
            : `failed (HTTP ${r.status})`;
    console.log(`   ${r.model.padEnd(16)} → ${verdict}`);
  }
  console.log("");
}

main();
