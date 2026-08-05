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

import {
  aiImageAttemptTimeoutMs,
  aiImageFetchErrorCode,
  canSpendAiImageDeadline,
  shouldRetryAiImageAttempt,
  type AiImageDeadline,
} from "./ai-image-deadline.ts";
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
  latencyMs: number;
  size: string;
  quality: string | null;
  outputFormat: string | null;
  /**
   * Always-on telemetry (additive, no behavior change): the actual decoded pixel
   * dimensions and aspect ratio of the returned image, and whether that deviates
   * from the `size` that was requested — beyond the known, expected gpt-image-1
   * portrait request (1024x1536 / 2:3), which is itself the deliberate closest-
   * available-size choice for a 4:5 poster crop (see the comment on `size` below),
   * not a mismatch. This compares actual bytes against the requested `size` string,
   * so that intentional 2:3-vs-4:5 gap never trips it; only a provider returning
   * something OTHER than what was asked for does. Null/false when undetermined —
   * never causes a rejection or retry here.
   */
  actualWidth?: number | null;
  actualHeight?: number | null;
  actualAspect?: string | null;
  aspectMismatch?: boolean;
};

export type OpenAiImageResult = {
  bytes: Uint8Array | null;
  attempts: OpenAiImageAttempt[];
};

function requestIdFromHeaders(headers: Headers): string | null {
  return headers.get("x-request-id") ?? headers.get("openai-request-id");
}

function cleanText(value: string | null | undefined, max = 240): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Reduced "W:H" string, e.g. formatAspectRatio(1024, 1536) -> "2:3". */
function formatAspectRatio(width: number, height: number): string {
  if (!width || !height) return "";
  const divisor = gcd(Math.round(width), Math.round(height)) || 1;
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

/**
 * Reads only the PNG signature + IHDR width/height (offsets 16-23) — no full pixel
 * decode. gpt-image-1 always returns PNG (`output_format: "png"` is sent on every
 * generate/edit call above), so this is enough for the telemetry in
 * OpenAiImageAttempt without pulling in a PNG decoder dependency into this module.
 * Returns null for any non-PNG or too-short input rather than throwing.
 */
function readPngDimensions(bytes: Uint8Array | null): { width: number; height: number } | null {
  if (!bytes || bytes.length < 24) return null;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (!isPng) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (!width || !height) return null;
  return { width, height };
}

function parseSizeString(size: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Always-on telemetry patch (additive, no behavior change): actualWidth/Height/Aspect
 * plus aspectMismatch computed against the `size` string that was actually sent on
 * this request (not the app's eventual 4:5 poster crop target — see the comment on
 * `OpenAiImageAttempt` above for why those are different things).
 */
function aspectTelemetryPatch(bytes: Uint8Array | null, requestedSize: string): Partial<OpenAiImageAttempt> {
  const dims = readPngDimensions(bytes);
  if (!dims) return { actualWidth: null, actualHeight: null, actualAspect: null, aspectMismatch: false };
  const actualAspect = formatAspectRatio(dims.width, dims.height);
  const expected = parseSizeString(requestedSize);
  const aspectMismatch = expected
    ? Math.abs(dims.width / dims.height - expected.width / expected.height) > 0.02
    : false;
  return { actualWidth: dims.width, actualHeight: dims.height, actualAspect, aspectMismatch };
}

/**
 * Category families that keep the legacy food/cafe framing in the v4 prompt variant.
 * Anything not matched here gets the non-food "Editorial commercial photography"
 * framing instead. Deliberately broad (matches on substring) since merchant-entered
 * category text is free-form.
 */
const FOOD_CATEGORY_PATTERN =
  /caf[eé]|coffee|restaurant|bakery|\bfood\b|diner|\bbar\b|grill|pizza|deli\b|donut|doughnut|bagel|ice cream|juice|smoothie|\bbbq\b|barbecue|kitchen|eatery|brewery|winery|bistro|\bpub\b|\btea\b|dessert|creamery|bakehouse|taco|burger|sandwich|snack/i;

function isFoodCategory(category: string): boolean {
  return FOOD_CATEGORY_PATTERN.test(category);
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

export function buildPhotoAdImagePrompt(
  params: {
    itemName: string;
    itemDescription?: string;
    businessName?: string;
    requiredVisualItems?: readonly string[];
    creativeDirection?: string | null;
    visualRevisionInstruction?: string;
    aspectRatio?: "1:1" | "4:5";
  },
  /**
   * Additive, optional. Absent (or promptVariant unset) reproduces the exact legacy
   * prompt byte-for-byte — every existing caller keeps its current behavior. Only
   * promptVariant: "v4" opts into category-aware subject/backdrop framing and the
   * zone-geometry rewrite (see zoneLine below).
   */
  opts: { promptVariant?: "v4"; businessCategory?: string; visualDirection?: string } = {},
): string {
  const { itemName, itemDescription, businessName, requiredVisualItems, creativeDirection, visualRevisionInstruction } = params;
  const esc = (s: string) => s.replace(/"/g, "'").trim();
  const visualItems = [...new Set((requiredVisualItems ?? []).map(esc).filter(Boolean))];
  const framing =
    params.aspectRatio === "4:5"
      ? "Vertical 4:5 poster-ready framing that fills the whole frame edge to edge (no borders, letterboxing, or flat color bands), with the product centered and calmer photographic zones top and bottom for native text."
      : "Square 1:1 framing.";

  const isV4 = opts.promptVariant === "v4";
  const category = isV4 ? cleanText(opts.businessCategory, 80) : "";
  const visualDirection = isV4 ? cleanText(opts.visualDirection, 200) : "";
  // Unknown/absent category keeps the legacy food framing (matches the pre-v4 default
  // subject, which always assumed food/cafe).
  const food = !isV4 || !category || isFoodCategory(category);

  const subjectLine = food
    ? `Editorial food photography — photoreal ${esc(itemName)} as the single hero subject.`
    : `Editorial commercial photography — photoreal ${esc(itemName)} as the single hero subject for a ${esc(category)} business.`;

  const businessContextLine = businessName
    ? food
      ? `For an independent cafe called ${esc(businessName)}.`
      : `For a ${category ? `${esc(category)} ` : ""}business called ${esc(businessName)}.`
    : "";

  const backdropLine = food
    ? "Cafe surface backdrop — light wood, marble, or matte ceramic — uncluttered."
    : visualDirection
    ? `Backdrop matching the setting: ${esc(visualDirection)} — clean, uncluttered, professionally lit.`
    : `Backdrop appropriate to a ${category ? esc(category) : "local"} business — clean, uncluttered, professionally lit.`;

  // gpt-image-1's only portrait size is 1024x1536 (2:3, see `size` in
  // attemptImageGeneration below). The app center-crops that to 4:5 for the poster:
  // keep the full 1024 width, take a 1024*(5/4) = 1280px-tall center window out of
  // the 1536px-tall source, dropping (1536-1280)/2 = 128px off the top and 128px off
  // the bottom -> 128/1536 = 8.3% shaved off each edge, keeping the central 83.3%.
  // buildGeminiAdImagePrompt's zone bullets (top quarter / hero 25%-65% / bottom
  // third) describe that POST-crop 4:5 frame. Restated in this GENERATED (pre-crop)
  // frame's own terms via pre = 0.083 + post * 0.833:
  //   post top quarter [0%, 25%]     -> pre [8.3%, 29.2%]  -> state "top ~29%"
  //   post hero lane    [25%, 65%]    -> pre [29.2%, 62.5%] -> state "hero 29%-63%"
  //   post bottom third [66.7%, 100%] -> pre [63.9%, 100%]  -> state "bottom ~37% (from 63%)"
  // Each stated band is rounded outward (wider, never narrower) so the sliver that
  // gets cropped away entirely (the first/last 8.3%) is safely included rather than
  // left as a gap in the instruction.
  const zoneLine = !isV4
    ? "Leave clean visual space near the top or bottom for native offer text overlays; keep those zones calm enough for contrast."
    : "Composition by zone (this is the generated 2:3 frame, before the app's center-crop to 4:5): keep the top 29% of the frame one continuous, calm, softly defocused backdrop with no busy detail. Place the hero subject in the middle lane, roughly 29% to 63% of the frame height. Keep the bottom 37% of the frame (from the 63% mark down) the same calm, continuous surface or soft shadow falloff — no props, cutlery, or bright spots competing there.";

  return [
    visualItems.length > 1
      ? `Required offer items: ${visualItems.join(", ")}. Show all required items together as equally important main subjects. Do not show only one item.`
      : "",
    subjectLine,
    itemDescription ? `Description: ${esc(itemDescription)}.` : "",
    businessContextLine,
    creativeDirection ? `Selected ad concept for composition only, never render as text: ${esc(creativeDirection)}.` : "",
    visualRevisionInstruction ? `Revision direction: ${esc(visualRevisionInstruction)}.` : "",
    "Natural soft daylight, realistic textures and cast shadows, true-to-life proportions, high fine detail, clean composition, shallow depth of field.",
    backdropLine,
    "Honest, appetizing, magazine-quality — not stocky, not illustrated, not a CGI render.",
    "Keep every required item fully inside the center-safe area and away from crop edges.",
    zoneLine,
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
  deadline?: AiImageDeadline,
  timeoutLeg = "openai_image_generation",
): Promise<OpenAiImageResult> {
  const startedAt = Date.now();
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
    latencyMs: 0,
    size,
    quality: null,
    outputFormat: null,
  };
  const attemptWithLatency = (patch: Partial<OpenAiImageAttempt>): OpenAiImageAttempt => ({
    ...attemptBase,
    ...patch,
    latencyMs: Date.now() - startedAt,
  });
  const timeout = aiImageAttemptTimeoutMs(deadline, timeoutLeg, IMAGE_CALL_TIMEOUT_MS);
  if (!timeout.ok) {
    return {
      bytes: null,
      attempts: [attemptWithLatency({
        errorCode: timeout.errorCode,
        errorMessage: "OpenAI image generation skipped because the request deadline was nearly exhausted.",
      })],
    };
  }
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
        signal: AbortSignal.timeout(timeout.timeoutMs),
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
          ...attemptWithLatency({}),
          errorCode,
          errorMessage: `OpenAI image generation failed with ${errorCode}.`,
        }],
      };
    }
    const decoded = await decodeImageResponse(res, logTag);
    return {
      bytes: decoded.bytes,
      attempts: [{
        ...attemptWithLatency({}),
        usage: decoded.usage,
        responseId: decoded.responseId,
        success: decoded.bytes !== null,
        errorCode: decoded.bytes ? null : "NO_IMAGE_DATA",
        errorMessage: decoded.bytes ? null : "OpenAI response did not include image data.",
        ...aspectTelemetryPatch(decoded.bytes, size),
      }],
    };
  } catch (error) {
    const errorCode = aiImageFetchErrorCode(error, deadline);
    console.log(JSON.stringify({ tag: logTag, event: "image_gen_error", model, errorCode }));
    return {
      bytes: null,
      attempts: [{
        ...attemptWithLatency({}),
        errorCode,
        errorMessage: errorCode === "TIMEOUT" || errorCode === "DEADLINE_EXCEEDED"
          ? "OpenAI image generation timed out before a usable response was returned."
          : "OpenAI image generation failed before a usable response was returned.",
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
  deadline?: AiImageDeadline,
  timeoutLeg = "openai_image_generation",
): Promise<OpenAiImageResult> {
  const first = await attemptImageGeneration(openAiKey, model, prompt, logTag, posterStyleDalle3, deadline, timeoutLeg);
  if (first.bytes) return first;
  if (model === OPENAI_IMAGE_MODEL_FALLBACK) return first; // already tried the safe model
  const firstAttempt = first.attempts[0];
  if (
    !firstAttempt ||
    !shouldRetryAiImageAttempt(firstAttempt, deadline, 20_000) ||
    !canSpendAiImageDeadline(deadline, "openai_model_fallback", 35_000)
  ) {
    return first;
  }

  console.log(
    JSON.stringify({
      tag: logTag,
      event: "image_gen_fallback",
      from: model,
      to: OPENAI_IMAGE_MODEL_FALLBACK,
    }),
  );
  const fallback = await attemptImageGeneration(
    openAiKey,
    OPENAI_IMAGE_MODEL_FALLBACK,
    prompt,
    logTag,
    posterStyleDalle3,
    deadline,
    "openai_model_fallback",
  );
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
  deadline?: AiImageDeadline,
  timeoutLeg = "openai_image_generation",
): Promise<OpenAiImageResult> {
  return await requestImageGenerationJson(
    openAiKey,
    RESOLVED_IMAGE_GENERATE_MODEL,
    prompt,
    logTag,
    false,
    deadline,
    timeoutLeg,
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
  deadline?: AiImageDeadline;
  timeoutLeg?: string;
}): Promise<OpenAiImageResult> {
  const startedAt = Date.now();
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
    latencyMs: 0,
    size: "1024x1024",
    quality: "high",
    outputFormat: "png",
  };
  const attemptWithLatency = (patch: Partial<OpenAiImageAttempt>): OpenAiImageAttempt => ({
    ...attemptBase,
    ...patch,
    latencyMs: Date.now() - startedAt,
  });
  if (!validateEditInput(imageBytes, imageMime)) {
    return {
      bytes: null,
      attempts: [{
        ...attemptWithLatency({}),
        errorCode: "INVALID_INPUT_IMAGE",
        errorMessage: "Image edit input validation failed.",
      }],
    };
  }
  const timeout = aiImageAttemptTimeoutMs(params.deadline, params.timeoutLeg ?? "openai_image_edit", IMAGE_CALL_TIMEOUT_MS);
  if (!timeout.ok) {
    return {
      bytes: null,
      attempts: [attemptWithLatency({
        errorCode: timeout.errorCode,
        errorMessage: "OpenAI image edit skipped because the request deadline was nearly exhausted.",
      })],
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
        signal: AbortSignal.timeout(timeout.timeoutMs),
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
          ...attemptWithLatency({}),
          errorCode,
          errorMessage: `OpenAI image edit failed with ${errorCode}.`,
        }],
      };
    }
    const decoded = await decodeImageResponse(res, logTag);
    return {
      bytes: decoded.bytes,
      attempts: [{
        ...attemptWithLatency({}),
        usage: decoded.usage,
        responseId: decoded.responseId,
        success: decoded.bytes !== null,
        errorCode: decoded.bytes ? null : "NO_IMAGE_DATA",
        errorMessage: decoded.bytes ? null : "OpenAI response did not include image data.",
        ...aspectTelemetryPatch(decoded.bytes, attemptBase.size),
      }],
    };
  } catch (error) {
    const errorCode = aiImageFetchErrorCode(error, params.deadline);
    console.log(
      JSON.stringify({ tag: logTag, event: "enhance_error", treatment, errorCode }),
    );
    return {
      bytes: null,
      attempts: [{
        ...attemptWithLatency({}),
        errorCode,
        errorMessage: errorCode === "TIMEOUT" || errorCode === "DEADLINE_EXCEEDED"
          ? "OpenAI image edit timed out before a usable response was returned."
          : "OpenAI image edit failed before a usable response was returned.",
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
