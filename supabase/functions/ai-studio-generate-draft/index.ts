import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { calculateAiCost, logAiCost } from "../_shared/ai-costs.ts";

type DraftInput = {
  business_id?: unknown;
  product_name?: unknown;
  product_description?: unknown;
  offer_type?: unknown;
  offer_terms?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  quantity_limit?: unknown;
  style_preset?: unknown;
  reference_image_path?: unknown;
  cta?: unknown;
  dry_run?: unknown;
  copy_only?: unknown;
};

type DraftCreative = {
  headline: string;
  supporting_copy: string;
  image_prompt: string;
  image_asset_path: string | null;
  image_signed_url: string | null;
  style_preset: string;
  layout_recommendation: string;
  publishing_disabled: true;
};

const PROMPT_VERSION = "ai_studio_draft_v2";
const PIPELINE_VERSION = "ai_studio_draft_dev_v1";
const ALLOWED_STYLES = new Set(["Fresh", "Bold", "Premium", "Sunrise", "Macro"]);
const DEFAULT_CTA = "Claim in Twofer";
const REQUIRED_IMAGE_PROMPT_CLAUSES = [
  "No text.",
  "No letters.",
  "No logo.",
  "No watermark.",
  "Leave negative space for app-rendered copy.",
  "Use a 4:5 mobile composition.",
];

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalText(value: unknown, max: number): string | null {
  const trimmed = text(value, max);
  return trimmed ? trimmed : null;
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(1|true|yes|on)$/i.test(value.trim());
  return fallback;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fallbackDraft(params: {
  productName: string;
  productDescription: string | null;
  offerType: string;
  offerTerms: string;
  stylePreset: string;
}): DraftCreative {
  const product = params.productName;
  const descriptor = params.productDescription ? `${params.productDescription} ` : "";
  const styleLine = {
    Fresh: "bright natural light, crisp appetizing texture, clean seasonal color",
    Bold: "high contrast lighting, saturated color, energetic composition",
    Premium: "elevated editorial lighting, refined surfaces, polished detail",
    Sunrise: "warm morning light, soft glow, welcoming neighborhood mood",
    Macro: "close-up food photography, rich texture, shallow depth of field",
  }[params.stylePreset] ?? "clean appetizing product photography";

  return {
    headline: `${product} offer, ready to preview`.slice(0, 72),
    supporting_copy: `${descriptor}${params.offerTerms}`.trim().slice(0, 180),
    image_prompt: [
      `${styleLine}.`,
      `Show ${product} as the hero product.`,
      "No text, no letters, no numbers, no logo, no business name, no CTA, no offer terms, no time, no quantity badge.",
      "No watermark.",
      "Leave clean negative space for app-rendered typography overlays.",
      "Use a 4:5 mobile composition for a phone feed card.",
    ].join(" "),
    image_asset_path: null,
    image_signed_url: null,
    style_preset: params.stylePreset,
    layout_recommendation: `${params.stylePreset} product hero with clean overlay-safe negative space.`,
    publishing_disabled: true,
  };
}

function includesAllImagePromptRequirements(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("no text") &&
    normalized.includes("no letters") &&
    normalized.includes("no logo") &&
    normalized.includes("no watermark") &&
    normalized.includes("negative space") &&
    (normalized.includes("4:5") || normalized.includes("four-by-five") || normalized.includes("mobile composition"))
  );
}

function ensureTextFreeImagePrompt(value: string, fallback: string): string {
  const base = (value || fallback).trim();
  const prompt = includesAllImagePromptRequirements(base)
    ? base
    : `${base} ${REQUIRED_IMAGE_PROMPT_CLAUSES.join(" ")}`;
  return text(prompt, 900);
}

function sanitizeGeneratedCopy(value: unknown, fallback: string, max: number): string {
  const cleaned = text(value, max);
  return cleaned || fallback;
}

function parseDraftInput(body: DraftInput) {
  const businessId = text(body.business_id, 80);
  const productName = text(body.product_name, 90);
  const productDescription = optionalText(body.product_description, 260);
  const offerType = text(body.offer_type, 80);
  const offerTerms = text(body.offer_terms, 260);
  const startTime = parseDate(body.start_time);
  const endTime = parseDate(body.end_time);
  const quantityLimit = positiveInteger(body.quantity_limit);
  const requestedStyle = text(body.style_preset, 24) || "Fresh";
  const stylePreset = ALLOWED_STYLES.has(requestedStyle) ? requestedStyle : "Fresh";
  const referenceImagePath = optionalText(body.reference_image_path, 300);
  const cta = text(body.cta, 80) || DEFAULT_CTA;

  const errors: string[] = [];
  if (!businessId) errors.push("business_id is required.");
  if (!productName) errors.push("product_name is required.");
  if (!offerType) errors.push("offer_type is required.");
  if (!offerTerms) errors.push("offer_terms is required.");
  if (!startTime) errors.push("start_time must be a valid ISO date.");
  if (!endTime) errors.push("end_time must be a valid ISO date.");
  if (startTime && endTime && new Date(endTime).getTime() <= new Date(startTime).getTime()) {
    errors.push("end_time must be after start_time.");
  }
  if (quantityLimit === null) errors.push("quantity_limit must be a positive integer.");

  return {
    errors,
    value: {
      businessId,
      productName,
      productDescription,
      offerType,
      offerTerms,
      startTime,
      endTime,
      quantityLimit,
      stylePreset,
      referenceImagePath,
      cta,
      dryRun: bool(body.dry_run, false),
      copyOnly: bool(body.copy_only, true),
    },
  };
}

async function generateCopyWithOpenAi(params: {
  apiKey: string;
  input: ReturnType<typeof parseDraftInput>["value"];
}): Promise<{ draft: DraftCreative; usage?: Record<string, unknown>; requestId?: string | null }> {
  const model = Deno.env.get("AI_STUDIO_TEXT_MODEL") ?? "gpt-4o-mini";
  const prompt = [
    "Create draft copy for a local deals app creative preview.",
    "Return strict JSON with headline, supporting_copy, image_prompt, and layout_recommendation.",
    "The offer facts below are locked. Do not change, reinterpret, round, shorten, translate, or invent product, offer terms, time window, quantity, CTA, price, or business name.",
    "Headline and supporting_copy may be persuasive, but must preserve the locked facts exactly when mentioned.",
    "The image_prompt is for a commercial image only. It must not include offer copy or any text to render.",
    "The image_prompt must explicitly include: no text, no letters, no logo, no watermark, negative space for copy, and 4:5 mobile composition.",
    "Never include the business name, CTA, offer terms, time, quantity, price, letters, numbers, logo, or watermark in the image prompt.",
    `Locked product: ${params.input.productName}`,
    `Description: ${params.input.productDescription ?? "none"}`,
    `Locked offer type: ${params.input.offerType}`,
    `Locked offer terms: ${params.input.offerTerms}`,
    `Locked start time: ${params.input.startTime}`,
    `Locked end time: ${params.input.endTime}`,
    `Locked quantity limit: ${params.input.quantityLimit}`,
    `Locked CTA: ${params.input.cta}`,
    `Requested style: ${params.input.stylePreset}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You write concise, factual advertising draft copy. Never alter offer facts." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
    }),
  });

  const requestId = response.headers.get("x-request-id");
  if (!response.ok) {
    throw new Error(`OPENAI_TEXT_FAILED:${response.status}`);
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : {};
  } catch {
    parsed = {};
  }
  const fallback = fallbackDraft({
    productName: params.input.productName,
    productDescription: params.input.productDescription,
    offerType: params.input.offerType,
    offerTerms: params.input.offerTerms,
    stylePreset: params.input.stylePreset,
  });
  return {
    draft: {
      headline: sanitizeGeneratedCopy(parsed.headline, fallback.headline, 72),
      supporting_copy: sanitizeGeneratedCopy(parsed.supporting_copy, fallback.supporting_copy, 180),
      image_prompt: ensureTextFreeImagePrompt(text(parsed.image_prompt, 900), fallback.image_prompt),
      image_asset_path: null,
      image_signed_url: null,
      style_preset: params.input.stylePreset,
      layout_recommendation: sanitizeGeneratedCopy(
        parsed.layout_recommendation,
        fallback.layout_recommendation,
        180,
      ),
      publishing_disabled: true,
    },
    usage: payload?.usage,
    requestId,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Function is not configured." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return json(req, { error: "Unauthorized. Please log in." }, 401);
  }

  let body: DraftInput;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON in request body" }, 400);
  }

  const parsed = parseDraftInput(body);
  if (parsed.errors.length > 0) {
    return json(req, { error: "Invalid draft input.", details: parsed.errors }, 400);
  }
  const input = parsed.value;

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("id,name,owner_id")
    .eq("id", input.businessId)
    .maybeSingle();
  if (businessError) {
    return json(req, { error: "Could not verify business ownership." }, 500);
  }
  if (!business || business.owner_id !== user.id) {
    return json(req, { error: "You do not manage this business." }, 403);
  }

  const requestGroupId = crypto.randomUUID();
  const idempotencyHash = await sha256Hex(JSON.stringify({ userId: user.id, input }));
  const idempotencyKey = `ai-studio-dev:${idempotencyHash.slice(0, 40)}`;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const forceDryRun = bool(Deno.env.get("AI_STUDIO_DRY_RUN"), false);
  const imageGenerationEnabled = bool(Deno.env.get("AI_STUDIO_ENABLE_IMAGE_GENERATION"), false);
  const dryRun = input.dryRun || forceDryRun || !openAiKey;
  const copyOnly = input.copyOnly || !imageGenerationEnabled;

  let draft = fallbackDraft({
    productName: input.productName,
    productDescription: input.productDescription,
    offerType: input.offerType,
    offerTerms: input.offerTerms,
    stylePreset: input.stylePreset,
  });
  let provider = "fallback";
  let model = "dry-run-fallback";
  let usage: Record<string, unknown> | undefined;
  let requestId: string | null | undefined;
  let fallbackReason: string | null = dryRun ? "DRY_RUN_OR_MISSING_OPENAI_KEY" : null;

  if (!dryRun && openAiKey) {
    try {
      const generated = await generateCopyWithOpenAi({ apiKey: openAiKey, input });
      draft = generated.draft;
      usage = generated.usage;
      requestId = generated.requestId;
      provider = "openai";
      model = Deno.env.get("AI_STUDIO_TEXT_MODEL") ?? "gpt-4o-mini";
      fallbackReason = null;
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message.slice(0, 120) : "OPENAI_TEXT_FAILED";
    }
  }
  draft.image_prompt = ensureTextFreeImagePrompt(draft.image_prompt, fallbackDraft({
    productName: input.productName,
    productDescription: input.productDescription,
    offerType: input.offerType,
    offerTerms: input.offerTerms,
    stylePreset: input.stylePreset,
  }).image_prompt);

  const estimatedCost = provider === "openai"
    ? calculateAiCost({ model, endpoint: "chat.completions", usage }).estimated_cost_usd
    : 0;

  const inputOffer = {
    product_name: input.productName,
    product_description: input.productDescription,
    offer_type: input.offerType,
    offer_terms: input.offerTerms,
    start_time: input.startTime,
    end_time: input.endTime,
    quantity_limit: input.quantityLimit,
    cta: input.cta,
    style_preset: input.stylePreset,
    reference_image_path: input.referenceImagePath,
    publishing_disabled: true,
    dry_run: dryRun,
    copy_only: copyOnly,
  };

  const { data: job, error: jobError } = await admin
    .from("ad_generation_jobs")
    .insert({
      business_id: input.businessId,
      owner_user_id: user.id,
      request_group_id: requestGroupId,
      idempotency_key: idempotencyKey,
      pipeline_version: PIPELINE_VERSION,
      status: "ready",
      stage: "ready",
      input_offer: inputOffer,
      eligible_media_count: input.referenceImagePath ? 1 : 0,
      generated_fallback_reason: null,
      error_code: fallbackReason,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select("id,request_group_id,status,stage")
    .single();
  if (jobError) {
    return json(req, { error: "Could not create draft generation job.", details: jobError.message }, 500);
  }

  const adSpec = {
    kind: "ai_studio_draft",
    businessId: input.businessId,
    businessName: business.name,
    headline: draft.headline,
    supportingCopy: draft.supporting_copy,
    imagePrompt: draft.image_prompt,
    imageAssetPath: draft.image_asset_path,
    imageSignedUrl: draft.image_signed_url,
    stylePreset: draft.style_preset,
    layoutRecommendation: draft.layout_recommendation,
    lockedOffer: {
      productName: input.productName,
      offerType: input.offerType,
      offerTerms: input.offerTerms,
      startTime: input.startTime,
      endTime: input.endTime,
      quantityLimit: input.quantityLimit,
      cta: input.cta,
    },
    publishingDisabled: true,
    copyOnly,
    dryRun,
  };

  const { data: creative, error: creativeError } = await admin
    .from("ad_creatives")
    .insert({
      ad_generation_job_id: job.id,
      business_id: input.businessId,
      concept_label: "recommended",
      rank: 1,
      ad_spec: adSpec,
      text_provenance: {
        provider,
        model,
        promptVersion: PROMPT_VERSION,
        fallbackReason,
      },
      quality: {
        imageTextFreeRequired: true,
        imagePromptHasRequiredClauses: includesAllImagePromptRequirements(draft.image_prompt),
        noImageGeneration: true,
        publishingDisabled: true,
        dryRun,
      },
    })
    .select("id,ad_generation_job_id,business_id,ad_spec,created_at")
    .single();
  if (creativeError) {
    return json(req, { error: "Could not create draft creative.", details: creativeError.message }, 500);
  }

  const requestHash = await sha256Hex(JSON.stringify(inputOffer));
  await admin.from("ai_generation_logs").insert({
    business_id: input.businessId,
    user_id: user.id,
    request_type: "ai_studio_draft",
    input_mode: input.referenceImagePath ? "reference_image" : "structured",
    source_image_path: input.referenceImagePath,
    prompt_text: draft.image_prompt,
    request_hash: requestHash,
    prompt_version: PROMPT_VERSION,
    model,
    success: true,
    failure_reason: fallbackReason,
    input_token_count: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_token_count: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    estimated_cost_usd: estimatedCost,
    response_payload: {
      job_id: job.id,
      creative_id: creative.id,
      provider,
      dry_run: dryRun,
      copy_only: copyOnly,
      layout_recommendation: draft.layout_recommendation,
      image_prompt_validated: includesAllImagePromptRequirements(draft.image_prompt),
      publishing_disabled: true,
    },
    openai_called: provider === "openai",
    user_agent: req.headers.get("user-agent"),
  });

  await logAiCost(admin, {
    businessId: input.businessId,
    ownerUserId: user.id,
    requestGroupId,
    feature: "ai_studio_draft",
    provider,
    model,
    endpoint: provider === "openai" ? "chat.completions" : "dry_run",
    usage,
    estimatedCostUsd: provider === "openai" ? estimatedCost : 0,
    openaiRequestId: requestId ?? null,
    success: true,
  });

  return json(req, {
    draft: {
      job_id: job.id,
      creative_id: creative.id,
      request_group_id: job.request_group_id,
      business_id: input.businessId,
      creative: adSpec,
      image_asset_path: draft.image_asset_path,
      image_signed_url: draft.image_signed_url,
      publishing_disabled: true,
      dry_run: dryRun,
      copy_only: copyOnly,
    },
  });
});
