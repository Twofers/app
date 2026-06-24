import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  const path = ".env.development.local";
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function invoke(url, anonKey, accessToken, body) {
  const response = await fetch(`${url}/functions/v1/ai-studio-generate-draft`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

loadLocalEnv();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
assert(supabaseUrl, "Missing EXPO_PUBLIC_SUPABASE_URL");
assert(anonKey, "Missing EXPO_PUBLIC_SUPABASE_ANON_KEY");

const sampleBody = {
  business_id: process.env.TWOFER_SMOKE_BUSINESS_ID ?? "00000000-0000-0000-0000-000000000000",
  product_name: "Smoke Test Latte",
  product_description: "A warm espresso drink for local testing.",
  offer_type: "buy_one_get_one",
  offer_terms: "Buy one latte, get one latte free.",
  start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  end_time: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  quantity_limit: 5,
  style_preset: "Fresh",
  dry_run: true,
  copy_only: true,
};

const unauth = await invoke(supabaseUrl, anonKey, null, sampleBody);
assert(unauth.response.status === 401, `Expected unauthenticated 401, got ${unauth.response.status}`);

const email = process.env.TWOFER_SMOKE_EMAIL;
const password = process.env.TWOFER_SMOKE_PASSWORD;
const businessId = process.env.TWOFER_SMOKE_BUSINESS_ID;

if (!email || !password || !businessId) {
  console.log(JSON.stringify({
    unauthenticatedRejected: true,
    authenticatedChecksSkipped: true,
    reason: "Missing TWOFER_SMOKE_EMAIL, TWOFER_SMOKE_PASSWORD, or TWOFER_SMOKE_BUSINESS_ID in local env.",
  }, null, 2));
} else {
  const supabase = createClient(supabaseUrl, anonKey);
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  assert(!authError && auth.session?.access_token, `Smoke sign-in failed: ${authError?.message ?? "missing session"}`);

  const authed = await invoke(supabaseUrl, anonKey, auth.session.access_token, {
    ...sampleBody,
    business_id: businessId,
  });
  assert(authed.response.status === 200, `Expected authenticated 200, got ${authed.response.status}: ${JSON.stringify(authed.json)}`);

  const draft = authed.json?.draft;
  assert(draft?.job_id, "Missing draft.job_id");
  assert(draft?.creative_id, "Missing draft.creative_id");
  assert(draft?.publishing_disabled === true, "Publishing must remain disabled");
  assert(draft?.dry_run === true, "Smoke test must run in dry_run mode");
  assert(draft?.image_signed_url === null, "Smoke dry-run must not expose a public/signed asset URL");

  const wrongBusiness = await invoke(supabaseUrl, anonKey, auth.session.access_token, {
    ...sampleBody,
    business_id: "00000000-0000-0000-0000-000000000000",
  });
  assert(wrongBusiness.response.status === 403, `Expected wrong-business 403, got ${wrongBusiness.response.status}`);

  console.log(JSON.stringify({
    unauthenticatedRejected: true,
    authenticatedDraftCreated: true,
    wrongBusinessRejected: true,
    jobId: draft.job_id,
    creativeId: draft.creative_id,
    publishingDisabled: true,
    dryRun: true,
    privateAssetOnly: draft.image_asset_path === null && draft.image_signed_url === null,
  }, null, 2));
}
