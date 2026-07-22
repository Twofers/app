import {
  aiImageAttemptTimeoutMs,
  aiImageFetchErrorCode,
  shouldRetryAiImageAttempt,
  type AiImageDeadline,
} from "./ai-image-deadline.ts";

export type AiImageProvider = "gemini" | "openai" | "stock" | "none";

export type AiImageStylePreset = "realistic-local-ad" | "premium-cafe" | "playful-twofer";
export type AiImageAspectRatio = "1:1" | "4:3" | "16:9" | "4:5";
export type AiImageSize = "1K" | "2K";

export type AiImageReference = {
  mimeType: string;
  base64: string;
};

export type AiImageProviderConfig = {
  configuredPrimaryProvider: AiImageProvider;
  primaryProvider: AiImageProvider;
  fallbackProvider: AiImageProvider;
  geminiEnabled: boolean;
  geminiModel: string;
  geminiEstimatedCost1KUsd: number;
  ownerPhotoReferenceEnabled: boolean;
  stockFallbackEnabled: boolean;
};

export type GenerateAdImageInput = {
  businessId: string;
  businessName: string;
  businessCategory?: string;
  offerTitle: string;
  offerDescription?: string;
  paidItem?: string;
  freeItem?: string;
  dealType?: string;
  ownerPhotoUrl?: string | null;
  referenceImages?: AiImageReference[];
  creativeDirection?: string | null;
  customEditInstruction?: string;
  stylePreset: AiImageStylePreset;
  aspectRatio: AiImageAspectRatio;
  imageSize: AiImageSize;
};

export type GeminiImageAttempt = {
  provider: "gemini";
  model: string;
  endpoint: "interactions.create" | "models.generateContent";
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  promptHash: string;
  latencyMs: number;
  estimatedCostUsd: number;
  mimeType: string | null;
  aspectRatio: AiImageAspectRatio;
  imageSize: AiImageSize;
  retry: boolean;
};

export type GeminiImageResult = {
  bytes: Uint8Array | null;
  mimeType: string | null;
  prompt: string;
  promptHash: string;
  model: string;
  estimatedCostUsd: number;
  attempts: GeminiImageAttempt[];
  /**
   * Band luminance measured from the decoded pixels during JPEG->PNG conversion,
   * when that conversion ran. Null when Gemini already returned PNG (no decode
   * happened); callers fall back to decoding the in-memory bytes.
   */
  luma?: { top: number; bottom: number } | null;
};

type EnvReader = {
  get(name: string): string | undefined | null;
};

const GEMINI_IMAGE_MODEL_FALLBACK = "gemini-3.1-flash-image";
const GEMINI_INTERACTIONS_ENDPOINT = "interactions.create" as const;
const GEMINI_GENERATE_CONTENT_ENDPOINT = "models.generateContent" as const;
const GEMINI_CALL_TIMEOUT_MS = 60_000;

export const GEMINI_IMAGE_MODEL_ALLOWLIST = new Set([
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
]);

const STYLE_PRESET_TEXT: Record<AiImageStylePreset, string> = {
  "realistic-local-ad":
    "Style: realistic local cafe advertisement, natural light, clean counter or table, approachable, appetizing, not overly polished.",
  "premium-cafe":
    "Style: premium independent cafe marketing photo, warm light, shallow depth of field, high-end but still realistic, not corporate stock-photo looking.",
  "playful-twofer":
    "Style: playful local deal image, realistic food or drink, subtle cheerful energy. Do not add app mascots, characters, animals, or unrelated decorative props.",
};

function edgeEnv(): EnvReader {
  return Deno.env;
}

function cleanText(value: string | null | undefined, max = 240): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function parseProvider(value: string | null | undefined, fallback: AiImageProvider): AiImageProvider {
  const normalized = cleanText(value, 32).toLowerCase();
  if (normalized === "gemini" || normalized === "openai" || normalized === "stock" || normalized === "none") {
    return normalized;
  }
  return fallback;
}

function envFlag(env: EnvReader, name: string, fallback = false): boolean {
  const raw = env.get(name);
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envNumber(env: EnvReader, name: string, fallback: number): number {
  const raw = Number(env.get(name));
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export function resolveGeminiImageModel(env: EnvReader = edgeEnv()): string {
  const configured = cleanText(env.get("GEMINI_IMAGE_MODEL"), 120);
  if (configured && GEMINI_IMAGE_MODEL_ALLOWLIST.has(configured)) return configured;
  if (configured) {
    console.warn(
      JSON.stringify({
        tag: "gemini_image_config",
        event: "image_model_fallback",
        skipped_unlisted: configured.slice(0, 80),
        fallback: GEMINI_IMAGE_MODEL_FALLBACK,
      }),
    );
  }
  return GEMINI_IMAGE_MODEL_FALLBACK;
}

export function resolveAiImageProviderConfig(env: EnvReader = edgeEnv()): AiImageProviderConfig {
  const configuredPrimaryProvider = parseProvider(env.get("AI_IMAGE_PROVIDER"), "openai");
  const geminiEnabled = envFlag(env, "AI_IMAGE_GEMINI_ENABLED", false);
  const primaryProvider =
    configuredPrimaryProvider === "gemini" && !geminiEnabled ? "openai" : configuredPrimaryProvider;
  return {
    configuredPrimaryProvider,
    primaryProvider,
    fallbackProvider: parseProvider(env.get("AI_IMAGE_FALLBACK_PROVIDER"), "openai"),
    geminiEnabled,
    geminiModel: resolveGeminiImageModel(env),
    geminiEstimatedCost1KUsd: envNumber(env, "GEMINI_IMAGE_ESTIMATED_COST_1K_USD", 0.067),
    ownerPhotoReferenceEnabled: envFlag(env, "AI_IMAGE_OWNER_PHOTO_REFERENCE_ENABLED", true),
    stockFallbackEnabled: envFlag(env, "AI_IMAGE_STOCK_FALLBACK_ENABLED", true),
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function offerMechanics(input: GenerateAdImageInput): string {
  const paid = cleanText(input.paidItem, 120);
  const free = cleanText(input.freeItem, 120);
  if (paid && free && paid.toLowerCase() !== free.toLowerCase()) return `Buy ${paid}, get ${free} free.`;
  if (paid && free) return `Buy one ${paid}, get one ${free} free.`;
  return cleanText(input.offerDescription, 180) || cleanText(input.offerTitle, 180) || "local BOGO deal.";
}

function customEditInstruction(input: GenerateAdImageInput): string {
  const instruction = cleanText(input.customEditInstruction, 400);
  if (!instruction) return "";
  return [
    "Merchant bounded custom edit instruction:",
    instruction,
    "Apply this only as styling, composition, lighting, crop, cleanup, or background guidance.",
    "Do not add text, prices, discounts, coupons, QR codes, logos, fake brands, people, characters, or extra offer items.",
    "Do not remove, replace, or materially change the paid item, free item, item count, product identity, or offer meaning.",
  ].join(" ");
}

export function buildGeminiAdImagePrompt(
  input: GenerateAdImageInput,
  options: { genericizeItems?: boolean } = {},
): string {
  const businessCategory = cleanText(input.businessCategory, 80) || "local cafe";
  // F4 (2026-07-20): image providers can refuse an evocative branded item name
  // as literal content — e.g. a coffee named after military ranks ("Sergeant's
  // Stripes") returns no image from both Gemini and OpenAI, burning the whole
  // fallback chain before a hard IMAGE_REQUIRED. genericizeItems drops the brand
  // tokens — business name, item names, and the AI concept line — and asks only
  // for the business-category product. Used as a fallback after a no-image
  // refusal; the exact identity is rendered by the app as native text, so the ad
  // stays faithful to the offer.
  const genericSubject =
    `an appealing, professionally photographed ${businessCategory} product (the actual food or drink being sold)`;
  const businessName = options.genericizeItems
    ? "a local business"
    : cleanText(input.businessName, 120) || "local business";
  const paid = cleanText(input.paidItem, 120);
  const free = cleanText(input.freeItem, 120);
  const creativeDirection = options.genericizeItems ? "" : cleanText(input.creativeDirection, 280);
  const visualItems = options.genericizeItems ? [genericSubject] : [...new Set([paid, free].filter(Boolean))];
  const mechanics = options.genericizeItems
    ? `Feature ${genericSubject} as the clear main subject. The exact offer terms are rendered by the app, never in the image.`
    : offerMechanics(input);
  const framing =
    input.aspectRatio === "4:5"
      ? "Use vertical 4:5 poster-ready framing that fills the entire frame edge to edge, with the product centered and calmer (not empty) photographic zones toward the top and bottom for native text."
      : "Use a composition that works as a square mobile feed image.";
  const referenceInstruction =
    input.referenceImages && input.referenceImages.length > 0
      ? "Use the supplied owner photo as visual reference. Preserve the real product identity and improve only composition, lighting, crop, and background."
      : "Create the product-focused visual from the offer facts only.";
  const customInstruction = customEditInstruction(input);

  return [
    "Create a realistic, professional local business advertising image for a mobile deal app.",
    "",
    `Business context for styling only, never render as text: ${businessName}`,
    `Business type for styling only: ${businessCategory}`,
    `Offer mechanics: ${mechanics}`,
    "Ad context: The image will be used inside a mobile local-deal card.",
    visualItems.length > 0 ? `Required visible items: ${visualItems.join(", ")}.` : "",
    creativeDirection ? `Selected AI ad concept for composition only, never render as text: ${creativeDirection}` : "",
    referenceInstruction,
    customInstruction,
    "",
    "Image requirements:",
    "- Show the actual paid item and free item clearly if they are visually distinct.",
    "- Make the food or drink look real, appetizing, and professionally photographed.",
    "- Use natural lighting and a local business marketing style.",
    "- Avoid the glossy, fake, over-rendered AI look.",
    "- Keep every required item fully inside the center-safe area and away from crop edges.",
    "- Fill the whole vertical frame edge to edge with the photograph. No borders, margins, framing bars, letterboxing, vignette frames, or flat solid-color bands on any side — even when two items sit side by side, extend the scene (surface, background) to every edge instead of padding with empty space.",
    // Zone geometry, stated as fractions the model can actually act on. The app prints its
    // largest type over the top quarter and the bottom third, so those are the two places
    // the photograph must be quietest — yet measured across the corpus they came back the
    // BUSIEST (mean horizontal contrast 0.26 in the top band vs 0.23 in the middle, 5 of 6
    // cells inverted). A generic "keep it calm" bullet did not carry; naming the fractions,
    // the subject's lane, and the specific high-contrast offenders is the fix.
    "- Composition by zone: the app prints large text across the top quarter of the image and across the bottom third. Build the photograph around that. Place the hero subject entirely in the middle lane, roughly 25% to 65% of the height — it must not intrude into the top quarter or run down into the bottom third.",
    "- The top quarter must read as ONE continuous, softly defocused backdrop — a plain wall, a single wash of background tone, or a heavily out-of-focus interior with nothing picked out. Keep windows, lamps, bright highlights, shelves, doorways, hard edges, and any second point of interest out of it. A busy or high-contrast top band is the most common reason the headline becomes hard to read.",
    "- The bottom third is the same: one continuous surface or soft shadow falloff, with no cutlery, props, garnish, or bright spots competing.",
    "- Both zones must still be real photography (defocused background, table surface, soft shadow) — quiet, but never empty bands.",
    `- ${framing}`,
    "- The generated image must be text-free: no words, letters, numbers, discount copy, business names, app names, menu boards, signs, labels, stickers, or watermarks.",
    "- Do not add readable text.",
    "- Do not add coupons.",
    "- Do not add QR codes.",
    "- Do not add prices.",
    "- Do not add fake logos.",
    "- Do not add fake business names.",
    "- Do not add app mascots, characters, animals, penguins, or unrelated decorative props unless they are the actual product being sold or visible in the owner reference photo.",
    "- Do not add distorted hands, extra fingers, warped cups, impossible packaging, or strange food shapes.",
    "- Do not misrepresent the offer.",
    STYLE_PRESET_TEXT[input.stylePreset],
    "",
    "Avoid:",
    "AI-looking plastic food, readable or unreadable fake text, misspelled signs, extra cups, incorrect item counts, app mascots, unrelated characters, distorted hands, fake QR codes, fake logos, fake brand marks, random menu boards, uncanny people, strange reflections, watermark-like marks, unrealistic packaging, and any text inside the generated image.",
    "",
    "The final headline, business name, CTA, quantity, expiration, and offer terms will be rendered by the app outside this image. Do not render those words inside the image.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
}

export function buildSimplifiedGeminiImagePrompt(basePrompt: string): string {
  return [
    "Create a simple realistic food-and-drink product photo for a local cafe mobile deal card.",
    "Show only the required offer items from the original prompt as clear main subjects.",
    "Natural light, clean table, professional but realistic.",
    "No readable text, no logos, no people, no hands, no QR codes, no prices, no signs.",
    "",
    "Original offer prompt:",
    basePrompt.slice(0, 1600),
  ].join("\n");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function normalizeGeminiImageToPng(
  bytes: Uint8Array,
  mimeType: string | null,
): Promise<{ bytes: Uint8Array; mimeType: "image/png"; converted: boolean; luma: { top: number; bottom: number } | null }> {
  const normalizedMime = (mimeType ?? "image/png").toLowerCase();
  if (normalizedMime === "image/png") {
    return { bytes, mimeType: "image/png", converted: false, luma: null };
  }
  if (normalizedMime !== "image/jpeg" && normalizedMime !== "image/jpg") {
    throw new Error(`Unsupported Gemini image MIME type: ${normalizedMime || "(missing)"}`);
  }

  const jpegSpecifier = "jpeg-js";
  const pngSpecifier = "pngjs";
  const jpegModule = await import(jpegSpecifier);
  const pngModule = await import(pngSpecifier);
  const decode = (jpegModule as { default?: { decode?: unknown }; decode?: unknown }).default?.decode ??
    (jpegModule as { decode?: unknown }).decode;
  const PngCtor = (pngModule as { PNG?: unknown; default?: { PNG?: unknown } }).PNG ??
    (pngModule as { default?: { PNG?: unknown } }).default?.PNG;
  if (typeof decode !== "function" || typeof PngCtor !== "function") {
    throw new Error("PNG conversion dependencies are unavailable.");
  }

  const decoded = decode(bytes, { useTArray: true }) as { width?: number; height?: number; data?: Uint8Array };
  if (!decoded.width || !decoded.height || !decoded.data) {
    throw new Error("Gemini JPEG decode returned no pixel data.");
  }
  const png = new (PngCtor as new (options: { width: number; height: number }) => { data: Uint8Array })({
    width: decoded.width,
    height: decoded.height,
  });
  png.data.set(decoded.data);
  const sync = (PngCtor as unknown as { sync?: { write?: (png: unknown) => Uint8Array } }).sync;
  if (typeof sync?.write !== "function") {
    throw new Error("PNG encoder is unavailable.");
  }
  // We already hold decoded RGBA here — measure the legibility bands now rather
  // than paying for a second decode (pngjs `sync.read`) later. That re-decode is
  // the suspected reason poster.luma came back null in prod.
  const luma = computeBandLuminanceFromRgba(decoded.data, decoded.width, decoded.height);
  return { bytes: new Uint8Array(sync.write(png)), mimeType: "image/png", converted: true, luma };
}

/**
 * Best-effort top/bottom band luminance (0..1) of a generated poster image, so the
 * native renderer can size its legibility scrim to the image instead of a fixed
 * fallback. Reuses the same pngjs/jpeg-js decoders already bundled for PNG
 * conversion. Fail-safe: any decode problem returns null and the renderer keeps
 * its safe fallback scrim. Bands approximate the 4:5 poster crop (top ~0-24.5%,
 * bottom ~65.8-100% of image height).
 */
export function computeBandLuminanceFromRgba(
  data: Uint8Array,
  width: number,
  height: number,
): { top: number; bottom: number } | null {
  if (!width || !height || !data) return null;
  if (data.length < width * height * 4) return null;
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const band = (y0f: number, y1f: number): number => {
    let sum = 0;
    let n = 0;
    const y0 = Math.max(0, Math.floor(y0f * height));
    const y1 = Math.min(height, Math.ceil(y1f * height));
    for (let y = y0; y < y1; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const i = (width * y + x) * 4;
        sum += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]);
        n++;
      }
    }
    return n ? sum / n : 0.5;
  };
  const round = (v: number): number => Math.round(v * 1000) / 1000;
  return { top: round(band(0, 0.245)), bottom: round(band(0.658, 1)) };
}

/**
 * Decoder outcome for band luminance. `reason` is a short, self-authored code
 * (never an upstream provider body) so a post-deploy smoke can tell WHY luma
 * came back null instead of guessing — edge logs are not readable via the CLI.
 */
export type BandLuminanceOutcome = {
  luma: { top: number; bottom: number } | null;
  decoder: "png" | "jpeg" | null;
  reason: string | null;
};

export async function computeImageBandLuminanceDetailed(
  bytes: Uint8Array,
  mimeType?: string | null,
): Promise<BandLuminanceOutcome> {
  let decoder: "png" | "jpeg" | null = null;
  try {
    if (!bytes || bytes.length < 16) return { luma: null, decoder: null, reason: "empty_bytes" };
    const looksPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const normalizedMime = (mimeType ?? "").toLowerCase();
    const treatAsPng = looksPng || normalizedMime === "image/png";
    decoder = treatAsPng ? "png" : "jpeg";
    let width = 0;
    let height = 0;
    let data: Uint8Array | null = null;
    if (treatAsPng) {
      const pngSpecifier = "pngjs";
      const pngModule = await import(pngSpecifier);
      const PngCtor = (pngModule as { PNG?: unknown; default?: { PNG?: unknown } }).PNG ??
        (pngModule as { default?: { PNG?: unknown } }).default?.PNG;
      const sync = (PngCtor as unknown as { sync?: { read?: (b: Uint8Array) => { width: number; height: number; data: Uint8Array } } })?.sync;
      if (typeof sync?.read !== "function") return { luma: null, decoder, reason: "png_sync_read_unavailable" };
      const png = sync.read(bytes);
      width = png.width;
      height = png.height;
      data = png.data;
    } else {
      const jpegSpecifier = "jpeg-js";
      const jpegModule = await import(jpegSpecifier);
      const decode = (jpegModule as { default?: { decode?: unknown }; decode?: unknown }).default?.decode ??
        (jpegModule as { decode?: unknown }).decode;
      if (typeof decode !== "function") return { luma: null, decoder, reason: "jpeg_decode_unavailable" };
      const decoded = (decode as (b: Uint8Array, o: { useTArray: boolean }) => { width?: number; height?: number; data?: Uint8Array })(
        bytes,
        { useTArray: true },
      );
      width = decoded.width ?? 0;
      height = decoded.height ?? 0;
      data = decoded.data ?? null;
    }
    if (!width || !height || !data) return { luma: null, decoder, reason: "decode_no_pixels" };
    const luma = computeBandLuminanceFromRgba(data, width, height);
    return { luma, decoder, reason: luma ? null : "band_math_no_pixels" };
  } catch (err) {
    return { luma: null, decoder, reason: `decode_threw:${String((err as Error)?.name ?? "Error").slice(0, 40)}` };
  }
}

export async function computeImageBandLuminance(
  bytes: Uint8Array,
  mimeType?: string | null,
): Promise<{ top: number; bottom: number } | null> {
  return (await computeImageBandLuminanceDetailed(bytes, mimeType)).luma;
}

function normalizeGeminiErrorCode(status: number): string {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 404) return "MODEL_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "UPSTREAM_ERROR";
  return `HTTP_${status}`;
}

function findInlineImagePart(json: unknown): { data: string; mimeType: string | null } | null {
  const candidates = (json as { candidates?: unknown[] } | null)?.candidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    const parts = (candidate as { content?: { parts?: unknown[] } } | null)?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const record = part as Record<string, unknown>;
      const inlineData = (record.inlineData ?? record.inline_data) as Record<string, unknown> | undefined;
      const data = inlineData && typeof inlineData.data === "string" ? inlineData.data : "";
      if (!data) continue;
      const mimeType =
        typeof inlineData?.mimeType === "string"
          ? inlineData.mimeType
          : typeof inlineData?.mime_type === "string"
          ? inlineData.mime_type
          : null;
      return { data, mimeType };
    }
  }
  return null;
}

function findInteractionImagePart(json: unknown): { data: string; mimeType: string | null } | null {
  const record = json as Record<string, unknown> | null;
  const outputImage = (record?.output_image ?? record?.outputImage) as Record<string, unknown> | undefined;
  if (outputImage && typeof outputImage.data === "string" && outputImage.data) {
    const mimeType =
      typeof outputImage.mime_type === "string"
        ? outputImage.mime_type
        : typeof outputImage.mimeType === "string"
        ? outputImage.mimeType
        : null;
    return { data: outputImage.data, mimeType };
  }

  const steps = record?.steps;
  if (!Array.isArray(steps)) return null;
  for (const step of steps) {
    const stepRecord = step as Record<string, unknown>;
    const blocks = stepRecord.type === "model_output" && Array.isArray(stepRecord.content)
      ? stepRecord.content
      : stepRecord.type === "thought" && Array.isArray(stepRecord.summary)
      ? stepRecord.summary
      : [];
    for (const block of blocks) {
      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type !== "image" || typeof blockRecord.data !== "string" || !blockRecord.data) continue;
      const mimeType =
        typeof blockRecord.mime_type === "string"
          ? blockRecord.mime_type
          : typeof blockRecord.mimeType === "string"
          ? blockRecord.mimeType
          : null;
      return { data: blockRecord.data, mimeType };
    }
  }
  return null;
}

function shouldUseInteractionsApi(model: string): boolean {
  return /^gemini-3(?:\.|-)/.test(model);
}

function buildGeminiInputParts(params: {
  prompt: string;
  referenceImages?: AiImageReference[];
}): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = [];
  for (const image of params.referenceImages ?? []) {
    const mimeType = cleanText(image.mimeType, 80) || "image/png";
    if (!image.base64) continue;
    input.push({ type: "image", mime_type: mimeType, data: image.base64 });
  }
  input.push({ type: "text", text: params.prompt });
  return input;
}

async function decodeGeminiImagePart(params: {
  imagePart: { data: string; mimeType: string | null };
  attemptBase: GeminiImageAttempt;
  startedAt: number;
}): Promise<{ bytes: Uint8Array | null; mimeType: string | null; attempt: GeminiImageAttempt; luma: { top: number; bottom: number } | null }> {
  const imageMimeType = params.imagePart.mimeType ?? "image/png";
  let normalizedImage: { bytes: Uint8Array; mimeType: "image/png"; converted: boolean; luma: { top: number; bottom: number } | null };
  try {
    normalizedImage = await normalizeGeminiImageToPng(base64ToBytes(params.imagePart.data), imageMimeType);
  } catch {
    return {
      bytes: null,
      mimeType: null,
      luma: null,
      attempt: {
        ...params.attemptBase,
        latencyMs: Date.now() - params.startedAt,
        errorCode: "PNG_CONVERSION_FAILED",
        errorMessage: "Gemini image output could not be converted to PNG.",
      },
    };
  }
  return {
    bytes: normalizedImage.bytes,
    mimeType: normalizedImage.mimeType,
    luma: normalizedImage.luma,
    attempt: {
      ...params.attemptBase,
      success: true,
      latencyMs: Date.now() - params.startedAt,
      mimeType: normalizedImage.mimeType,
    },
  };
}

async function attemptGeminiImageGeneration(params: {
  apiKey: string | null | undefined;
  model: string;
  prompt: string;
  promptHash: string;
  aspectRatio: AiImageAspectRatio;
  imageSize: AiImageSize;
  estimatedCostUsd: number;
  referenceImages?: AiImageReference[];
  retry: boolean;
  deadline?: AiImageDeadline;
  timeoutLeg?: string;
}): Promise<{ bytes: Uint8Array | null; mimeType: string | null; attempt: GeminiImageAttempt; luma: { top: number; bottom: number } | null }> {
  const startedAt = Date.now();
  const useInteractionsApi = shouldUseInteractionsApi(params.model);
  const attemptBase: GeminiImageAttempt = {
    provider: "gemini",
    model: params.model,
    endpoint: useInteractionsApi ? GEMINI_INTERACTIONS_ENDPOINT : GEMINI_GENERATE_CONTENT_ENDPOINT,
    success: false,
    errorCode: null,
    errorMessage: null,
    promptHash: params.promptHash,
    latencyMs: 0,
    estimatedCostUsd: params.estimatedCostUsd,
    mimeType: null,
    aspectRatio: params.aspectRatio,
    imageSize: params.imageSize,
    retry: params.retry,
  };

  const apiKey = cleanText(params.apiKey, 400);
  if (!apiKey) {
    return {
      bytes: null,
      mimeType: null,
      luma: null,
      attempt: {
        ...attemptBase,
        latencyMs: Date.now() - startedAt,
        errorCode: "MISSING_GEMINI_API_KEY",
        errorMessage: "Gemini API key is not configured.",
      },
    };
  }

  const timeout = aiImageAttemptTimeoutMs(
    params.deadline,
    params.timeoutLeg ?? (params.retry ? "gemini_retry" : "gemini_primary"),
    GEMINI_CALL_TIMEOUT_MS,
  );
  if (!timeout.ok) {
    return {
      bytes: null,
      mimeType: null,
      luma: null,
      attempt: {
        ...attemptBase,
        latencyMs: Date.now() - startedAt,
        errorCode: timeout.errorCode,
        errorMessage: "Gemini image generation skipped because the request deadline was nearly exhausted.",
      },
    };
  }

  try {
    const legacyParts = buildGeminiInputParts({
      prompt: params.prompt,
      referenceImages: params.referenceImages,
    }).map((part) =>
      part.type === "image"
        ? { inlineData: { mimeType: part.mime_type, data: part.data } }
        : { text: part.text }
    );
    const endpointUrl = useInteractionsApi
      ? "https://generativelanguage.googleapis.com/v1beta/interactions"
      : `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(params.model)}:generateContent`;
    const interactionsBody = (includeResponseFormat: boolean) =>
      JSON.stringify({
        model: params.model,
        input: buildGeminiInputParts({ prompt: params.prompt, referenceImages: params.referenceImages }),
        ...(includeResponseFormat
          ? {
            response_format: {
              type: "image",
              aspect_ratio: params.aspectRatio,
              image_size: params.imageSize,
            },
          }
          : {}),
      });
    const legacyBody = JSON.stringify({
      contents: [{ parts: legacyParts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: params.aspectRatio,
          imageSize: params.imageSize,
        },
      },
    });
    const timeoutLeg = params.timeoutLeg ?? (params.retry ? "gemini_retry" : "gemini_primary");
    const geminiFetch = (body: string, timeoutMs: number) =>
      fetch(endpointUrl, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    let res = await geminiFetch(useInteractionsApi ? interactionsBody(true) : legacyBody, timeout.timeoutMs);
    if (useInteractionsApi && res.status === 400) {
      // An earlier structured-output shape drew HTTP 400 from this endpoint
      // (2026-07-14 incident), so a rejected response_format must never kill
      // generation: retry once without it and accept the default aspect ratio.
      console.warn(
        JSON.stringify({
          tag: "gemini_image_config",
          event: "response_format_rejected",
          model: params.model,
        }),
      );
      const formatRetryTimeout = aiImageAttemptTimeoutMs(params.deadline, `${timeoutLeg}_format_retry`, GEMINI_CALL_TIMEOUT_MS);
      if (!formatRetryTimeout.ok) {
        return {
          bytes: null,
          mimeType: null,
          luma: null,
          attempt: {
            ...attemptBase,
            latencyMs: Date.now() - startedAt,
            errorCode: formatRetryTimeout.errorCode,
            errorMessage: "Gemini image generation skipped because the request deadline was nearly exhausted.",
          },
        };
      }
      res = await geminiFetch(interactionsBody(false), formatRetryTimeout.timeoutMs);
    }

    if (!res.ok) {
      const errorCode = normalizeGeminiErrorCode(res.status);
      return {
        bytes: null,
        mimeType: null,
        luma: null,
        attempt: {
          ...attemptBase,
          latencyMs: Date.now() - startedAt,
          errorCode,
          errorMessage: `Gemini image generation failed with ${errorCode}.`,
        },
      };
    }

    const json = await res.json();
    const imagePart = useInteractionsApi ? findInteractionImagePart(json) : findInlineImagePart(json);
    if (!imagePart) {
      return {
        bytes: null,
        mimeType: null,
        luma: null,
        attempt: {
          ...attemptBase,
          latencyMs: Date.now() - startedAt,
          errorCode: "NO_IMAGE_DATA",
          errorMessage: "Gemini returned no inline image data.",
        },
      };
    }

    return decodeGeminiImagePart({ imagePart, attemptBase, startedAt });
  } catch (error) {
    const errorCode = aiImageFetchErrorCode(error, params.deadline);
    return {
      bytes: null,
      mimeType: null,
      luma: null,
      attempt: {
        ...attemptBase,
        latencyMs: Date.now() - startedAt,
        errorCode,
        errorMessage: errorCode === "TIMEOUT" || errorCode === "DEADLINE_EXCEEDED"
          ? "Gemini image generation timed out before a usable response was returned."
          : "Gemini image generation failed before a usable response was returned.",
      },
    };
  }
}

export async function generateGeminiAdImageWithTelemetry(params: {
  apiKey: string | null | undefined;
  model: string;
  prompt: string;
  aspectRatio?: AiImageAspectRatio;
  imageSize?: AiImageSize;
  estimatedCostUsd?: number;
  referenceImages?: AiImageReference[];
  retryOnFailure?: boolean;
  deadline?: AiImageDeadline;
  firstAttemptLeg?: string;
  retryAttemptLeg?: string;
  fastRetryMaxLatencyMs?: number;
}): Promise<GeminiImageResult> {
  const aspectRatio = params.aspectRatio ?? "1:1";
  const imageSize = params.imageSize ?? "1K";
  const estimatedCostUsd = params.estimatedCostUsd ?? 0.067;
  const promptHash = await sha256Hex(params.prompt);
  const first = await attemptGeminiImageGeneration({
    apiKey: params.apiKey,
    model: params.model,
    prompt: params.prompt,
    promptHash,
    aspectRatio,
    imageSize,
    estimatedCostUsd,
    referenceImages: params.referenceImages,
    retry: false,
    deadline: params.deadline,
    timeoutLeg: params.firstAttemptLeg,
  });
  if (
    first.bytes ||
    params.retryOnFailure === false ||
    !shouldRetryAiImageAttempt(first.attempt, params.deadline, params.fastRetryMaxLatencyMs ?? 20_000)
  ) {
    return {
      bytes: first.bytes,
      mimeType: first.mimeType,
      prompt: params.prompt,
      promptHash,
      model: params.model,
      estimatedCostUsd: first.attempt.success ? estimatedCostUsd : 0,
      attempts: [first.attempt],
      luma: first.luma,
    };
  }

  const retryPrompt = buildSimplifiedGeminiImagePrompt(params.prompt);
  const retryPromptHash = await sha256Hex(retryPrompt);
  const retry = await attemptGeminiImageGeneration({
    apiKey: params.apiKey,
    model: params.model,
    prompt: retryPrompt,
    promptHash: retryPromptHash,
    aspectRatio,
    imageSize,
    estimatedCostUsd,
    referenceImages: params.referenceImages,
    retry: true,
    deadline: params.deadline,
    timeoutLeg: params.retryAttemptLeg,
  });

  return {
    bytes: retry.bytes,
    mimeType: retry.mimeType,
    prompt: retry.bytes ? retryPrompt : params.prompt,
    promptHash: retry.bytes ? retryPromptHash : promptHash,
    model: params.model,
    estimatedCostUsd: retry.attempt.success ? estimatedCostUsd : 0,
    attempts: [first.attempt, retry.attempt],
    luma: retry.luma,
  };
}
