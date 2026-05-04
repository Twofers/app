/**
 * Shared OpenAI image generation helpers.
 *
 * Used by:
 * - ai-compose-offer: single poster with baked-in text.
 * - ai-generate-ad-variants: photographic single ad — no baked-in text; the app UI renders
 *   the headline above the image.
 */

/** Allowlisted image model ids only — never accept model names from clients. */
export const OPENAI_IMAGE_MODEL_ALLOWLIST = new Set([
  "chatgpt-image-latest",
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
]);

const OPENAI_IMAGE_MODEL_FALLBACK = "gpt-image-2";

const MAX_EDIT_IMAGE_BYTES = 25 * 1024 * 1024;
const MIN_EDIT_IMAGE_BYTES = 64;

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
    "Square promotional graphic for a local café deal mobile app (TWOFER).",
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
}): string {
  const { itemName, itemDescription, businessName } = params;
  const esc = (s: string) => s.replace(/"/g, "'").trim();
  return [
    `Editorial food photography — photoreal ${esc(itemName)} as the single hero subject.`,
    itemDescription ? `Description: ${esc(itemDescription)}.` : "",
    businessName ? `For an independent cafe called ${esc(businessName)}.` : "",
    "Natural soft daylight, realistic textures and cast shadows, true-to-life proportions, high fine detail, clean composition, shallow depth of field.",
    "Cafe surface backdrop — light wood, marble, or matte ceramic — uncluttered.",
    "Honest, appetizing, magazine-quality — not stocky, not illustrated, not a CGI render.",
    "Absolutely no text, logos, labels, signage, banners, overlays, or QR codes.",
    "No human faces, no hands holding the item.",
    "Square 1:1 framing.",
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

async function requestImageGenerationJson(
  openAiKey: string,
  model: string,
  prompt: string,
  logTag: string,
  /** Poster flow historically used vivid + standard on DALL·E 3 only; ignored for GPT image models. */
  posterStyleDalle3?: boolean,
): Promise<Uint8Array | null> {
  try {
    const payload: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size: "1024x1024",
    };
    if (isDalle3(model)) {
      payload.quality = posterStyleDalle3 ? "standard" : "hd";
      payload.style = posterStyleDalle3 ? "vivid" : "natural";
      payload.response_format = "b64_json";
    } else if (isDalle2(model)) {
      payload.response_format = "b64_json";
    } else if (usesGptImageGenerationShape(model)) {
      // GPT image models: b64 in response by default; do not send response_format or dall-e-3 style.
      payload.quality = "high";
      payload.output_format = "png";
    }
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.log(
        JSON.stringify({
          tag: logTag,
          event: "image_gen_http",
          status: res.status,
          body: errBody.slice(0, 800),
        }),
      );
      return null;
    }
    return await decodeImageResponse(res, logTag);
  } catch (e) {
    console.log(JSON.stringify({ tag: logTag, event: "image_gen_error", err: String(e) }));
    return null;
  }
}

// ---------------------------------------------------------------------------
// V2: Photographic ad — generate when no cafe photo
// ---------------------------------------------------------------------------

export async function generatePhotoAdImage(
  openAiKey: string,
  prompt: string,
  logTag = "ai_ads_v2",
): Promise<Uint8Array | null> {
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
  logTag?: string;
}): Promise<Uint8Array | null> {
  const { openAiKey, imageBytes, imageMime, treatment, logTag = "ai_ads_v2_enhance" } = params;
  if (!validateEditInput(imageBytes, imageMime)) {
    return null;
  }
  try {
    const model = RESOLVED_IMAGE_EDIT_MODEL;
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", TREATMENT_PROMPTS[treatment]);
    form.append("size", "1024x1024");
    form.append("quality", "high");
    form.append("output_format", "png");
    form.append("n", "1");
    if (!isDalle2(model)) {
      form.append("input_fidelity", "high");
    }
    const blob = new Blob([imageBytes], { type: normalizeEditMime(imageMime) || "image/png" });
    form.append("image", blob, editFilenameForMime(imageMime));

    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.log(
        JSON.stringify({
          tag: logTag,
          event: "enhance_http",
          treatment,
          status: res.status,
          body: errBody.slice(0, 800),
        }),
      );
      return null;
    }
    return await decodeImageResponse(res, logTag);
  } catch (e) {
    console.log(
      JSON.stringify({ tag: logTag, event: "enhance_error", treatment, err: String(e) }),
    );
    return null;
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
  const model = RESOLVED_IMAGE_GENERATE_MODEL;
  return await requestImageGenerationJson(openAiKey, model, prompt, logTag, isDalle3(model));
}

// ---------------------------------------------------------------------------
// Internal: decode b64_json (or fall back to URL fetch) from an OpenAI response
// ---------------------------------------------------------------------------

async function decodeImageResponse(
  res: Response,
  logTag: string,
): Promise<Uint8Array | null> {
  const j = await res.json();
  const row = j?.data?.[0] as Record<string, unknown> | undefined;
  const b64 = row?.b64_json;
  if (typeof b64 === "string" && b64.length > 0) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
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
      return null;
    }
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    return buf.length > 0 ? buf : null;
  }
  console.log(
    JSON.stringify({ tag: logTag, event: "image_gen_no_data" }),
  );
  return null;
}
