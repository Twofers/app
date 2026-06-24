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

function imagePromptHasRequiredClauses(value) {
  const normalized = String(value ?? "").toLowerCase();
  return (
    normalized.includes("no text") &&
    normalized.includes("no letters") &&
    normalized.includes("no logo") &&
    normalized.includes("no watermark") &&
    normalized.includes("negative space") &&
    (normalized.includes("4:5") || normalized.includes("four-by-five") || normalized.includes("mobile composition"))
  );
}

function assertLockedOffer(draft, expected) {
  const locked = draft?.creative?.lockedOffer;
  assert(locked?.productName === expected.product_name, "AI changed the locked product name");
  assert(locked?.offerTerms === expected.offer_terms, "AI changed the locked offer terms");
  assert(locked?.startTime === expected.start_time, "AI changed the locked start time");
  assert(locked?.endTime === expected.end_time, "AI changed the locked end time");
  assert(locked?.quantityLimit === expected.quantity_limit, "AI changed the locked quantity limit");
  assert(locked?.cta === expected.cta, "AI changed the locked CTA");
}

function assertPrivateAiAsset(draft) {
  const path = draft?.image_asset_path;
  assert(typeof path === "string" && path.length > 0, "Gemini image smoke must return a private storage path");
  assert(!/^https?:\/\//i.test(path), "Image asset path must not be a public URL");
  assert(path.includes("/"), "Image asset path should be owner/business scoped");
  assert(typeof draft?.image_signed_url === "string" && draft.image_signed_url.startsWith("http"), "Image preview must use a signed URL");
  assert(draft?.image_provider === "gemini", `Expected Gemini image provider, got ${draft?.image_provider}`);
  assert(draft?.image_generation_success === true, "Gemini image generation did not report success");
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
  cta: "Claim in Twofer",
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
  assert(imagePromptHasRequiredClauses(draft?.creative?.imagePrompt), "Image prompt is missing required text-free clauses");
  assertLockedOffer(draft, { ...sampleBody, business_id: businessId });

  const wrongBusiness = await invoke(supabaseUrl, anonKey, auth.session.access_token, {
    ...sampleBody,
    business_id: "00000000-0000-0000-0000-000000000000",
  });
  assert(wrongBusiness.response.status === 403, `Expected wrong-business 403, got ${wrongBusiness.response.status}`);

  const result = {
    unauthenticatedRejected: true,
    authenticatedDraftCreated: true,
    wrongBusinessRejected: true,
    jobId: draft.job_id,
    creativeId: draft.creative_id,
    publishingDisabled: true,
    dryRun: true,
    privateAssetOnly: draft.image_asset_path === null && draft.image_signed_url === null,
    imagePromptValidated: true,
  };

  if (process.env.TWOFER_SMOKE_REAL_AI === "true") {
    const real = await invoke(supabaseUrl, anonKey, auth.session.access_token, {
      ...sampleBody,
      business_id: businessId,
      dry_run: false,
      copy_only: true,
    });
    assert(real.response.status === 200, `Expected real copy/prompt 200, got ${real.response.status}: ${JSON.stringify(real.json)}`);
    const realDraft = real.json?.draft;
    assert(realDraft?.job_id, "Missing real draft.job_id");
    assert(realDraft?.creative_id, "Missing real draft.creative_id");
    assert(realDraft?.publishing_disabled === true, "Real copy/prompt must keep publishing disabled");
    assert(realDraft?.copy_only === true, "Real copy/prompt smoke must stay copy_only");
    assert(realDraft?.image_asset_path === null && realDraft?.image_signed_url === null, "Real copy/prompt must not create image assets");
    assert(realDraft?.creative?.headline, "Real copy/prompt must include a headline");
    assert(realDraft?.creative?.supportingCopy, "Real copy/prompt must include supporting copy");
    assert(realDraft?.creative?.layoutRecommendation, "Real copy/prompt must include a layout recommendation");
    assert(imagePromptHasRequiredClauses(realDraft?.creative?.imagePrompt), "Real image prompt is missing required text-free clauses");
    assert(realDraft?.dry_run === false, "Expected real copy/prompt mode. If this fails, OPENAI_API_KEY may be missing or AI_STUDIO_DRY_RUN may be true.");
    assert(realDraft?.text_provider === "openai", `Expected GPT mini text provider via OpenAI, got ${realDraft?.text_provider}`);
    assert(realDraft?.text_model === "gpt-5.4-mini", `Expected OPENAI_MODEL gpt-5.4-mini, got ${realDraft?.text_model}`);
    assert(realDraft?.fallback_reason === null, `Expected no real-mode fallback, got ${realDraft?.fallback_reason}`);
    assertLockedOffer(realDraft, { ...sampleBody, business_id: businessId, dry_run: false, copy_only: true });
    result.realCopyPrompt = {
      draftCreated: true,
      jobId: realDraft.job_id,
      creativeId: realDraft.creative_id,
      dryRun: false,
      textProvider: realDraft.text_provider,
      textModel: realDraft.text_model,
      imagePromptValidated: true,
      privateAssetOnly: true,
    };
  } else {
    result.realCopyPrompt = {
      skipped: true,
      reason: "Set TWOFER_SMOKE_REAL_AI=true locally after configuring the dev Supabase OPENAI_API_KEY secret.",
    };
  }

  if (process.env.TWOFER_SMOKE_GEMINI_IMAGE === "true") {
    const image = await invoke(supabaseUrl, anonKey, auth.session.access_token, {
      ...sampleBody,
      business_id: businessId,
      dry_run: false,
      copy_only: false,
    });
    assert(image.response.status === 200, `Expected Gemini image 200, got ${image.response.status}: ${JSON.stringify(image.json)}`);
    const imageDraft = image.json?.draft;
    assert(imageDraft?.job_id, "Missing Gemini image draft.job_id");
    assert(imageDraft?.creative_id, "Missing Gemini image draft.creative_id");
    assert(imageDraft?.publishing_disabled === true, "Gemini image draft must keep publishing disabled");
    assert(imageDraft?.copy_only === false, "Gemini image smoke must not be copy_only");
    assert(imageDraft?.dry_run === false, "Gemini image smoke must not be dry_run");
    assert(imageDraft?.text_provider === "openai", `Expected GPT mini text provider via OpenAI, got ${imageDraft?.text_provider}`);
    assert(imageDraft?.text_model === "gpt-5.4-mini", `Expected OPENAI_MODEL gpt-5.4-mini, got ${imageDraft?.text_model}`);
    assert(imagePromptHasRequiredClauses(imageDraft?.creative?.imagePrompt), "Gemini image prompt is missing required text-free clauses");
    assertLockedOffer(imageDraft, { ...sampleBody, business_id: businessId, dry_run: false, copy_only: false });
    assertPrivateAiAsset(imageDraft);
    result.geminiImage = {
      draftCreated: true,
      jobId: imageDraft.job_id,
      creativeId: imageDraft.creative_id,
      imageProvider: imageDraft.image_provider,
      imageModel: imageDraft.image_model,
      privateAssetPath: imageDraft.image_asset_path,
      signedPreviewReturned: true,
      publishingDisabled: true,
    };
  } else {
    result.geminiImage = {
      skipped: true,
      reason: "Set TWOFER_SMOKE_GEMINI_IMAGE=true locally after configuring the dev Supabase GEMINI_API_KEY secret and image flag.",
    };
  }

  console.log(JSON.stringify(result, null, 2));
}
