/**
 * Shared OpenAI image generation helpers.
 *
 * Used by:
 * - ai-compose-offer: single poster with baked-in text.
 * - ai-generate-ad-variants: photographic single ad — no baked-in text; the app UI renders
 *   the headline above the image.
 *
 * OpenAI runs only as the fallback image provider (Gemini is primary). When an OpenAI
 * image request is made, key selection (prepaid -> existing) and the auth fallback are
 * handled centrally by ./openai-fetch.ts. Models, prompts, payloads, the image-model
 * ladder, timeouts, and telemetry are unchanged.
 */

import { fetchOpenAiWithFallback } from "./openai-fetch.ts";

/**
 * Allowlisted image model ids only — never accept model names from clients.
 *
 * gpt-image-2 is intentionally NOT allowlisted: in production it fails every
 * request with FETCH_ERROR (it hangs until the per-call timeout), burning the
 * whole image budget before falling back to gpt-image-1. Because the dashboard
 * OPENAI_IMAGE_MODEL* secret currently points at gpt-image-2, dropping it here
 * makes pickGenerateModel() fall through to gpt-image-1 directly, so the failing
 * primary attempt is never made. (Re-added by mistake 2026-06-16; removed again
 * 2026-07-07 after it caused ai-generate-ad-variants to exceed the ~150s edge
 * worker limit and return no image. Confirmed via ai_generation_costs.)
 */
export const OPENAI_IMAGE_MODEL_ALLOWLIST = new Set([
  "chatgpt-image-latest",
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
]);

const OPENAI_IMAGE_MODEL_FALLBACK = "gpt-image-1";

const MAX_EDIT_IMAGE_BYTES = 25 * 1024 * 1024;
const MIN_EDIT_IMAGE_BYTES = 64;

/**
 * Per-call timeout for OpenAI image generate/edit requests. MUST stay safely below
 * the app's EDGE_FN_TIMEOUT_AI_MS (180s — see constants/timing.ts). The server runs
 * the research and copy stages BEFORE the image call, so if a slow or unavailable
 * image model lets the request hang near the full client budget, the app aborts the
 * whole invoke and shows "We couldn't generate ads right now." 60s leaves headroom
 * for the other stages while still letting a healthy model finish; on timeout the
 * caller falls back to the uploaded photo (or a no-image ad) instead of hard-failing.
 */
const IMAGE_CALL_TIMEOUT_MS = 60_000;

export type OpenAiImageAttempt = {
  model: string;
  endpoint: "images.generations" | "images.edits";
  usage: Record<string, unknown> | null;
  openaiRequestId: string | null;
  responseId: string | null;
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  size: string;
  quality: string | null;
  outputFormat: string | null;
};

export type OpenAiImageResult = {
  bytes: Uint8Array | null;
  attempts: OpenAiImageAttempt[];
};

function requestIdFromHeaders(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("openai-request-id");
}

function imageResponseMetadata(json: unknown): {
  usage: Record<string, unknown> | null;
  responseId: string | null;
} {
  const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const usage = obj.usage && typeof obj.usage === "object"
    ? (obj.usage as Record<string, unknown>)
    : null;
  const responseId = typeof obj.id === "string" ? obj.id : null;
  return { usage, responseId };
}

/**
 * Picks the first non-empty allowlisted value from ordered env candidates.
 * Legacy: `OPENAI_IMAGE_MODEL` / `OPENAI_IMAGE_EDIT_MODEL` remain supported for older secrets.
 */
function resolveAllowlistedModelFromCandidates(
  candidates: (string | undefined)[],
  role: "generate" | "edit",
): string {
  const seen = new Set<string>();
  const skippedUnlisted: string[] = [];
  for (const raw of candidates) {
    const m = raw?.trim();
    if (!m || seen.has(m)) continue;
    seen.add(m);
    if (OPENAI_IMAGE_MODEL_ALLOWLIST.has(m)) return m;
    skippedUnlisted.push(m.slice(0, 80));
  }
  console.warn(
    JSON.stringify({
      tag: "openai_image_config",
      event: "image_model_fallback",
      role,
      reason: skippedUnlisted.length === 0 ? "no_env_candidates" : "no_allowlisted_candidate",
      skipped_unlisted: skippedUnlisted.slice(0, 6),
      fallback: OPENAI_IMAGE_MODEL_FALLBACK,
    }),
  );
  return OPENAI_IMAGE_MODEL_FALLBACK;
}

/** Resolved once per isolate from Edge secrets (see env priority in module `resolveAllowlistedModelFromCandidates` calls). */
export const RESOLVED_IMAGE_GENERATE_MODEL = resolveAllowlistedModelFromCandidates(
  [
    Deno.env.get("OPENAI_IMAGE_MODEL_GENERATE"),
    Deno.env.get("OPENAI_IMAGE_MODEL_DEFAULT"),
    Deno.env.get("OPENAI_IMAGE_MODEL"),
  ],
  "generate",
);

export const RESOLVED_IMAGE_EDIT_MODEL = resolveAllowlistedModelFromCandidates(
  [
    Deno.env.get("OPENAI_IMAGE_MODEL_EDIT"),
    Deno.env.get("OPENAI_IMAGE_MODEL_DEFAULT"),
    Deno.env.get("OPENAI_IMAGE_EDIT_MODEL"),
    Deno.env.get("OPENAI_IMAGE_MODEL"),
  ],
  "edit",
);

// ---------------------------------------------------------------------------
// LEGACY: Generic poster prompt (used by ai-compose-offer)
// ---------------------------------------------------------------------------

export function buildPosterImagePrompt(params: {
  businessName: string;
  displayOffer: string;
  headline: string;
  sub: string;
  visualDirection: string;
}): string {
  const { businessName, displayOffer, headline, sub, visualDirection } = params;
  const esc = (s: string) => s.replace(/"/g, "'");
  return [
    "Square promotional graphic for a local café deal mobile app (Twofer).",
    "Photorealistic food or drink hero; crisp, legible typography as part of the design. No photorealistic human faces.",
    `Venue: ${esc(businessName)}.`,
    `Offer: ${esc(displayOffer)}.`,
    `Large readable headline on image: "${esc(headline || displayOffer)}".`,
    sub.trim() ? `Smaller subline: "${esc(sub)}".` : "",
    visualDirection.trim() ? `Mood: ${esc(visualDirection)}` : "",
    "Natural soft light, realistic textures and shadows, editorial product style. Accent color bright orange #FF9F1C; light background. English text only. No QR codes.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3800);
}

// ---------------------------------------------------------------------------
// V2: Photographic ad image — no text baked in, the app renders copy above the image
// ---------------------------------------------------------------------------

export function buildPhotoAdImagePrompt(params: {
  itemName: string;
  itemDescription?: string;
  businessName?: string;
  requiredVisualItems?: readonly string[];
  creativeDirection?: string | null;
  visualRevisionInstruction?: string;
  aspectRatio?: "1:1" | "4:5";
}): string {
  const { itemName, itemDescription, businessName, requiredVisualItems, creativeDirection, visualRevisionInstruction } = params;
  const esc = (s: string) => s.replace(/"/g, "'").trim();
  const visualItems = [...new Set((requiredVisualItems ?? []).map(esc).filter(Boolean))];
  const framing =
    params.aspectRatio === "4:5"
      ? "Vertical 4:5 poster-ready framing that fills the whole frame edge to edge (no borders, letterboxing, or flat color bands), with the product centered and calmer photographic zones top and bottom for native text."
      : "Square 1:1 framing.";
  return [
    visualItems.length > 1
      ? `Required offer items: ${visualItems.join(", ")}. Show all required items together as equally important main subjects. Do not show only one item.`
      : "",
    `Editorial food photography — photoreal ${esc(itemName)} as the single hero subject.`,
    itemDescription ? `Description: ${esc(itemDescription)}.` : "",
    businessName ? `For an independent cafe called ${esc(businessName)}.` : "",
    creativeDirection ? `Selected ad concept for composition only, never render as text: ${esc(creativeDirection)}.` : "",
    visualRevisionInstruction ? `Revision direction: ${esc(visualRevisionInstruction)}.` : "",
    "Natural soft daylight, realistic textures and cast shadows, true-to-life proportions, high fine detail, clean composition, shallow depth of field.",
    "Cafe surface backdrop — light wood, marble, or matte ceramic — uncluttered.",
    "Honest, appetizing, magazine-quality — not stocky, not illustrated, not a CGI render.",
    "Keep every required item fully inside the center-safe area and away from crop edges.",
    "Leave clean visual space near the top or bottom for native offer text overlays; keep those zones calm enough for contrast.",
    "Absolutely no text, letters, numbers, prices, coupons, discount copy, menu boards, signage, banners, overlays, QR codes, barcodes, logos, fake logos, brand marks, watermarks, mascots, cartoon characters, animals, or unrelated prop characters.",
    "No human faces, no hands holding the item.",
    framing,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3800);
}

function isDalle2(model: string): boolean {
  return model === "dall-e-2";
}

function isDalle3(model: string): boolean {
  return model === "dall-e-3";
}

/** True for GPT Image family and other non-DALL-E models handled like GPT for generations. */
function usesGptImageGenerationShape(model: string): boolean {
  return !isDalle2(model) && !isDalle3(model);
}

/** Single generation attempt against one model. Returns null on any failure (HTTP, decode, or timeout). */
async function attemptImageGeneration(
  openAiKey: string,
  model: string,
  prompt: string,
  logTag: string,
  /** Poster flow historically used vivid + standard on DALL·E 3 only; ignored for GPT image models. */
  posterStyleDalle3?: boolean,
): Promise<OpenAiImageResult> {
  // Ad images are rendered inside a 4:5 poster (cover-cropped). gpt-image-1 has no
  // 4:5 option, so request its closest portrait (1024x1536, 2:3) rather than a
  // square 1024x1024 — a square loses far more when cropped to 4:5 and is the
  // reason F4-fallback posters came back visibly cropped. DALL·E stays square
  // (legacy path; not the resolved generation model).
  const size = usesGptImageGenerationShape(model) ? "1024x1536" : "1024x1024";
  const attemptBase: OpenAiImageAttempt = {
    model,
    endpoint: "images.generations",
    usage: null,
    openaiRequestId: null,
    responseId: null,
    success: false,
    errorCode: null,
    errorMessage: null,
    size,
    quality: null,
    outputFormat: null,
  };
  try {
    const payload: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size,
    };
    if (isDalle3(model)) {
      payload.quality = posterStyleDalle3 ? "standard" : "hd";
      payload.style = posterStyleDalle3 ? "vivid" : "natural";
      payload.response_format = "b64_json";
      attemptBase.quality = String(payload.quality);
    } else if (isDalle2(model)) {
      payload.response_format = "b64_json";
    } else if (usesGptImageGenerationShape(model)) {
      // GPT image models: b64 in response by default; do not send response_format or dall-e-3 style.
      payload.quality = "high";
      payload.output_format = "png";
      attemptBase.quality = "high";
      attemptBase.outputFormat = "png";
    }
    const { response: res } = await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/images/generations",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(IMAGE_CALL_TIMEOUT_MS),
      },
      existingKeyOverride: openAiKey,
      logTag,
    });
    attemptBase.openaiRequestId = requestIdFromHeaders(res.headers);
    if (!res.ok) {
      const errorCode = `HTTP_${res.status}`;
      console.log(
        JSON.stringify({
          tag: logTag,
          event: "image_gen_http",
          model,
          status: res.status,
          errorCode,
        }),
      );
      return {
        bytes: null,
        attempts: [{
          ...attemptBase,
          errorCode,
          errorMessage: `OpenAI image generation failed with ${errorCode}.`,
        }],
      };
    }
    const decoded = await decodeImageResponse(res, logTag);
    return {
      bytes: decoded.bytes,
      attempts: [{
        ...attemptBase,
        usage: decoded.usage,
        responseId: decoded.responseId,
        success: decoded.bytes !== null,
        errorCode: decoded.bytes ? null : "NO_IMAGE_DATA",
        errorMessage: decoded.bytes ? null : "OpenAI response did not include image data.",
      }],
    };
  } catch {
    console.log(JSON.stringify({ tag: logTag, event: "image_gen_error", model, errorCode: "FETCH_ERROR" }));
    return {
      bytes: null,
      attempts: [{
        ...attemptBase,
        errorCode: "FETCH_ERROR",
        errorMessage: "OpenAI image generation failed before a usable response was returned.",
      }],
    };
  }
}

/**
 * Generate an image, with a one-shot fallback to the known-good model.
 *
 * The configured generate model (from the OPENAI_IMAGE_MODEL_* dashboard secrets) can be a
 * newer model that the OpenAI account can't call, or that rejects the production payload
 * (e.g. `quality: "high"` / `output_format: "png"`). When that happens the primary attempt
 * returns null and a text-only ad would ship with NO image. To keep the flagship feature
 * resilient we retry exactly once on OPENAI_IMAGE_MODEL_FALLBACK (`gpt-image-1`), which is
 * verified-good and accepts this same payload.
 *
 * Note on the time budget: a model/param rejection comes back as a fast HTTP 4xx, so the
 * fallback attempt has ample room inside the caller's per-call timeout. A primary that hard
 * *times out* leaves little headroom for the retry, but that path is no worse than today
 * (still ends in a null image) — the common, fast-failing case is the one this rescues.
 */
async function requestImageGenerationJson(
  openAiKey: string,
  model: string,
  prompt: string,
  logTag: string,
  posterStyleDalle3?: boolean,
): Promise<OpenAiImageResult> {
  const first = await attemptImageGeneration(openAiKey, model, prompt, logTag, posterStyleDalle3);
  if (first.bytes) return first;
  if (model === OPENAI_IMAGE_MODEL_FALLBACK) return first; // already tried the safe model

  console.log(
    JSON.stringify({
      tag: logTag,
      event: "image_gen_fallback",
      from: model,
      to: OPENAI_IMAGE_MODEL_FALLBACK,
    }),
  );
  const fallback = await attemptImageGeneration(openAiKey, OPENAI_IMAGE_MODEL_FALLBACK, prompt, logTag, posterStyleDalle3);
  return { bytes: fallback.bytes, attempts: [...first.attempts, ...fallback.attempts] };
}

// ---------------------------------------------------------------------------
// V2: Photographic ad — generate when no cafe photo
// ---------------------------------------------------------------------------

export async function generatePhotoAdImage(
  openAiKey: string,
  prompt: string,
  logTag = "ai_ads_v2",
): Promise<Uint8Array | null> {
  const result = await generatePhotoAdImageWithTelemetry(openAiKey, prompt, logTag);
  return result.bytes;
}

export async function generatePhotoAdImageWithTelemetry(
  openAiKey: string,
  prompt: string,
  logTag = "ai_ads_v2",
): Promise<OpenAiImageResult> {
  return await requestImageGenerationJson(
    openAiKey,
    RESOLVED_IMAGE_GENERATE_MODEL,
    prompt,
    logTag,
    false,
  );
}

// ---------------------------------------------------------------------------
// V2: Photo enhancement — treatment presets via images/edits
// ---------------------------------------------------------------------------

export type PhotoTreatment = "touchup" | "cleanbg" | "studiopolish";

const TREATMENT_PROMPTS: Record<PhotoTreatment, string> = {
  touchup:
    "Enhance lighting, correct white balance, lift shadows, sharpen detail, and remove minor noise. " +
    "Keep the same subject, framing, and background unless a defect fix requires a tiny local change. " +
    "Output a natural, photorealistic version of this same photo.",
  cleanbg:
    "Replace the background with a clean, neutral cafe surface (warm light wood or soft matte gray). " +
    "Preserve the hero subject — food or drink — exactly as shot: same colors, shape, angle, and proportions. " +
    "Natural daylight, soft realistic shadow under the subject. No text, logos, people, or extra objects.",
  studiopolish:
    "Re-light as editorial product photography: soft directional daylight from upper left, realistic shadow, gentle background blur. " +
    "The food or drink must stay recognizably the same item — proportions, garnish, and color true to the original. " +
    "Backdrop: clean cafe surface (light wood, marble, or matte ceramic). Photoreal textures. No text, logos, watermarks, or people.",
};

function cleanCustomEditInstruction(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 400) : "";
}

function treatmentPrompt(treatment: PhotoTreatment, customEditInstruction?: string): string {
  const custom = cleanCustomEditInstruction(customEditInstruction);
  if (!custom) return TREATMENT_PROMPTS[treatment];
  return [
    TREATMENT_PROMPTS[treatment],
    "",
    "Merchant bounded custom edit instruction:",
    custom,
    "Apply this only as styling, composition, lighting, crop, cleanup, or background guidance.",
    "Do not add text, prices, discounts, coupons, QR codes, logos, fake brands, people, characters, hands, or extra offer items.",
    "Do not remove, replace, or materially change the paid item, free item, item count, product identity, or offer meaning.",
  ].join("\n");
}

function normalizeEditMime(mime: string): string {
  return mime.toLowerCase().split(";")[0].trim();
}

function validateEditInput(bytes: Uint8Array, mime: string): boolean {
  if (bytes.length < MIN_EDIT_IMAGE_BYTES || bytes.length > MAX_EDIT_IMAGE_BYTES) {
    console.log(
      JSON.stringify({
        tag: "ai_image_edit",
        event: "validation_failed",
        reason: bytes.length > MAX_EDIT_IMAGE_BYTES ? "image_too_large" : "image_too_small",
        size: bytes.length,
      }),
    );
    return false;
  }
  const m = normalizeEditMime(mime);
  if (m !== "image/png" && m !== "image/jpeg" && m !== "image/webp") {
    console.log(
      JSON.stringify({
        tag: "ai_image_edit",
        event: "validation_failed",
        reason: "unsupported_mime",
        mime: m.slice(0, 40),
      }),
    );
    return false;
  }
  return true;
}

function editFilenameForMime(mime: string): string {
  const m = normalizeEditMime(mime);
  if (m === "image/jpeg") return "input.jpg";
  if (m === "image/webp") return "input.webp";
  return "input.png";
}

/**
 * Enhance an uploaded cafe photo using OpenAI's image edit endpoint (GPT image model).
 * Returns the enhanced PNG bytes, or null if the edit failed (caller falls back to original).
 */
export async function enhanceUploadedPhoto(params: {
  openAiKey: string;
  imageBytes: Uint8Array;
  imageMime: string;
  treatment: PhotoTreatment;
  customEditInstruction?: string;
  logTag?: string;
}): Promise<Uint8Array | null> {
  const result = await enhanceUploadedPhotoWithTelemetry(params);
  return result.bytes;
}

export async function enhanceUploadedPhotoWithTelemetry(params: {
  openAiKey: string;
  imageBytes: Uint8Array;
  imageMime: string;
  treatment: PhotoTreatment;
  customEditInstruction?: string;
  logTag?: string;
}): Promise<OpenAiImageResult> {
  const { openAiKey, imageBytes, imageMime, treatment, logTag = "ai_ads_v2_enhance" } = params;
  const attemptBase: OpenAiImageAttempt = {
    model: RESOLVED_IMAGE_EDIT_MODEL,
    endpoint: "images.edits",
    usage: null,
    openaiRequestId: null,
    responseId: null,
    success: false,
    errorCode: null,
    errorMessage: null,
    size: "1024x1024",
    quality: "high",
    outputFormat: "png",
  };
  if (!validateEditInput(imageBytes, imageMime)) {
    return {
      bytes: null,
      attempts: [{
        ...attemptBase,
        errorCode: "INVALID_INPUT_IMAGE",
        errorMessage: "Image edit input validation failed.",
      }],
    };
  }
  try {
    const model = RESOLVED_IMAGE_EDIT_MODEL;
    // Rebuild the multipart body per attempt so the prepaid -> existing key retry
    // sends a fresh, unconsumed form (a FormData request body is single-use).
    const buildEditForm = (): FormData => {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", treatmentPrompt(treatment, params.customEditInstruction));
      form.append("size", "1024x1024");
      form.append("quality", "high");
      form.append("output_format", "png");
      form.append("n", "1");
      if (!isDalle2(model)) {
        form.append("input_fidelity", "high");
      }
      const blob = new Blob([imageBytes as BlobPart], { type: normalizeEditMime(imageMime) || "image/png" });
      form.append("image", blob, editFilenameForMime(imageMime));
      return form;
    };

    const { response: res } = await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/images/edits",
      init: {
        method: "POST",
        signal: AbortSignal.timeout(IMAGE_CALL_TIMEOUT_MS),
      },
      buildBody: buildEditForm,
      existingKeyOverride: openAiKey,
      logTag,
    });
    attemptBase.openaiRequestId = requestIdFromHeaders(res.headers);
    if (!res.ok) {
      const errorCode = `HTTP_${res.status}`;
      console.log(
        JSON.stringify({
          tag: logTag,
          event: "enhance_http",
          treatment,
          status: res.status,
          errorCode,
        }),
      );
      return {
        bytes: null,
        attempts: [{
          ...attemptBase,
          errorCode,
          errorMessage: `OpenAI image edit failed with ${errorCode}.`,
        }],
      };
    }
    const decoded = await decodeImageResponse(res, logTag);
    return {
      bytes: decoded.bytes,
      attempts: [{
        ...attemptBase,
        usage: decoded.usage,
        responseId: decoded.responseId,
        success: decoded.bytes !== null,
        errorCode: decoded.bytes ? null : "NO_IMAGE_DATA",
        errorMessage: decoded.bytes ? null : "OpenAI response did not include image data.",
      }],
    };
  } catch {
    console.log(
      JSON.stringify({ tag: logTag, event: "enhance_error", treatment, errorCode: "FETCH_ERROR" }),
    );
    return {
      bytes: null,
      attempts: [{
        ...attemptBase,
        errorCode: "FETCH_ERROR",
        errorMessage: "OpenAI image edit failed before a usable response was returned.",
      }],
    };
  }
}

// ---------------------------------------------------------------------------
// LEGACY: poster generator for ai-compose-offer (text baked in)
// ---------------------------------------------------------------------------

export async function tryGeneratePosterPng(
  openAiKey: string,
  prompt: string,
  logTag = "ai_image",
): Promise<Uint8Array | null> {
  const result = await tryGeneratePosterPngWithTelemetry(openAiKey, prompt, logTag);
  return result.bytes;
}

export async function tryGeneratePosterPngWithTelemetry(
  openAiKey: string,
  prompt: string,
  logTag = "ai_image",
): Promise<OpenAiImageResult> {
  const model = RESOLVED_IMAGE_GENERATE_MODEL;
  return await requestImageGenerationJson(openAiKey, model, prompt, logTag, isDalle3(model));
}

// ---------------------------------------------------------------------------
// Internal: decode b64_json (or fall back to URL fetch) from an OpenAI response
// ---------------------------------------------------------------------------

async function decodeImageResponse(
  res: Response,
  logTag: string,
): Promise<{ bytes: Uint8Array | null; usage: Record<string, unknown> | null; responseId: string | null }> {
  const j = await res.json();
  const meta = imageResponseMetadata(j);
  const row = j?.data?.[0] as Record<string, unknown> | undefined;
  const b64 = row?.b64_json;
  if (typeof b64 === "string" && b64.length > 0) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { bytes: out, ...meta };
  }
  const imageUrl = typeof row?.url === "string" ? row.url : null;
  if (imageUrl) {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      console.log(
        JSON.stringify({
          tag: logTag,
          event: "image_gen_url_fetch",
          status: imgRes.status,
        }),
      );
      return { bytes: null, ...meta };
    }
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    return { bytes: buf.length > 0 ? buf : null, ...meta };
  }
  console.log(
    JSON.stringify({ tag: logTag, event: "image_gen_no_data" }),
  );
  return { bytes: null, ...meta };
}
