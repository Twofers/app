export type AiImageProvider = "gemini" | "openai" | "stock" | "none";

export type AiImageStylePreset = "realistic-local-ad" | "premium-cafe" | "playful-twofer";
export type AiImageAspectRatio = "1:1" | "4:3" | "16:9";
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
  visualNotes?: string;
  ownerPhotoUrl?: string | null;
  referenceImages?: AiImageReference[];
  stylePreset: AiImageStylePreset;
  aspectRatio: AiImageAspectRatio;
  imageSize: AiImageSize;
};

export type GeminiImageAttempt = {
  provider: "gemini";
  model: string;
  endpoint: "models.generateContent";
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
};

type EnvReader = {
  get(name: string): string | undefined | null;
};

const GEMINI_IMAGE_MODEL_FALLBACK = "gemini-3.1-flash-image";
const GEMINI_IMAGE_ENDPOINT = "models.generateContent" as const;
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
    "Style: playful local deal image, realistic food or drink, subtle cheerful energy. If the owner explicitly asks for a mascot or prop, include it as a visual element, not as text or a logo.",
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
  return cleanText(input.offerDescription, 180) || cleanText(input.offerTitle, 180) || "Twofer local BOGO deal.";
}

export function buildGeminiAdImagePrompt(input: GenerateAdImageInput): string {
  const businessName = cleanText(input.businessName, 120) || "local business";
  const businessCategory = cleanText(input.businessCategory, 80) || "local cafe";
  const paid = cleanText(input.paidItem, 120);
  const free = cleanText(input.freeItem, 120);
  const visualNotes = cleanText(input.visualNotes, 300);
  const visualItems = [...new Set([paid, free].filter(Boolean))];
  const referenceInstruction =
    input.referenceImages && input.referenceImages.length > 0
      ? "Use the supplied owner photo as visual reference. Preserve the real product identity and improve only composition, lighting, crop, and background."
      : "Create the product-focused visual from the offer facts only.";

  return [
    "Create a realistic, professional local business advertising image for a mobile deal app.",
    "",
    `Business context for styling only, never render as text: ${businessName}`,
    `Business type for styling only: ${businessCategory}`,
    `Offer mechanics: ${offerMechanics(input)}`,
    "Ad context: The image will be used inside a mobile local-deal card.",
    visualItems.length > 0 ? `Required visible items: ${visualItems.join(", ")}.` : "",
    visualNotes ? `Owner visual note to depict visually, never as words: ${visualNotes}.` : "",
    referenceInstruction,
    "",
    "Image requirements:",
    "- Show the actual paid item and free item clearly if they are visually distinct.",
    "- Make the food or drink look real, appetizing, and professionally photographed.",
    "- Use natural lighting and a local business marketing style.",
    "- Avoid the glossy, fake, over-rendered AI look.",
    "- Leave clean visual space near the top or bottom for the app to overlay the exact offer text later.",
    "- Use a composition that works as a square mobile feed image.",
    "- The generated image must be text-free: no words, letters, numbers, discount copy, business names, app names, menu boards, signs, labels, stickers, or watermarks.",
    "- Do not add readable text.",
    "- Do not add coupons.",
    "- Do not add QR codes.",
    "- Do not add prices.",
    "- Do not add fake logos.",
    "- Do not add fake business names.",
    "- Do not add distorted hands, extra fingers, warped cups, impossible packaging, or strange food shapes.",
    "- Do not misrepresent the offer.",
    STYLE_PRESET_TEXT[input.stylePreset],
    "",
    "Avoid:",
    "AI-looking plastic food, readable or unreadable fake text, misspelled signs, extra cups, incorrect item counts, distorted hands, fake QR codes, fake logos, fake brand marks, random menu boards, uncanny people, strange reflections, watermark-like marks, unrealistic packaging, and any text inside the generated image.",
    "",
    "The final headline, business name, CTA, quantity, expiration, and offer terms will be rendered by the app outside this image. Do not render those words inside the image.",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
}

export function buildSimplifiedGeminiImagePrompt(basePrompt: string): string {
  return [
    "Create a simple realistic square food-and-drink product photo for a local cafe mobile deal card.",
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
): Promise<{ bytes: Uint8Array; mimeType: "image/png"; converted: boolean }> {
  const normalizedMime = (mimeType ?? "image/png").toLowerCase();
  if (normalizedMime === "image/png") {
    return { bytes, mimeType: "image/png", converted: false };
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
  return { bytes: new Uint8Array(sync.write(png)), mimeType: "image/png", converted: true };
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
}): Promise<{ bytes: Uint8Array | null; mimeType: string | null; attempt: GeminiImageAttempt }> {
  const startedAt = Date.now();
  const attemptBase: GeminiImageAttempt = {
    provider: "gemini",
    model: params.model,
    endpoint: GEMINI_IMAGE_ENDPOINT,
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
      attempt: {
        ...attemptBase,
        latencyMs: Date.now() - startedAt,
        errorCode: "MISSING_GEMINI_API_KEY",
        errorMessage: "Gemini API key is not configured.",
      },
    };
  }

  try {
    const parts: Record<string, unknown>[] = [];
    for (const image of params.referenceImages ?? []) {
      const mimeType = cleanText(image.mimeType, 80) || "image/png";
      if (!image.base64) continue;
      parts.push({ inlineData: { mimeType, data: image.base64 } });
    }
    parts.push({ text: params.prompt });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
              aspectRatio: params.aspectRatio,
              imageSize: params.imageSize,
            },
          },
        }),
        signal: AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      return {
        bytes: null,
        mimeType: null,
        attempt: {
          ...attemptBase,
          latencyMs: Date.now() - startedAt,
          errorCode: normalizeGeminiErrorCode(res.status),
          errorMessage: errorText.slice(0, 500),
        },
      };
    }

    const json = await res.json();
    const imagePart = findInlineImagePart(json);
    if (!imagePart) {
      return {
        bytes: null,
        mimeType: null,
        attempt: {
          ...attemptBase,
          latencyMs: Date.now() - startedAt,
          errorCode: "NO_IMAGE_DATA",
          errorMessage: "Gemini returned no inline image data.",
        },
      };
    }

    const imageMimeType = imagePart.mimeType ?? "image/png";
    let normalizedImage: { bytes: Uint8Array; mimeType: "image/png"; converted: boolean };
    try {
      normalizedImage = await normalizeGeminiImageToPng(base64ToBytes(imagePart.data), imageMimeType);
    } catch (error) {
      return {
        bytes: null,
        mimeType: null,
        attempt: {
          ...attemptBase,
          latencyMs: Date.now() - startedAt,
          errorCode: "PNG_CONVERSION_FAILED",
          errorMessage: String(error).slice(0, 500),
        },
      };
    }
    return {
      bytes: normalizedImage.bytes,
      mimeType: normalizedImage.mimeType,
      attempt: {
        ...attemptBase,
        success: true,
        latencyMs: Date.now() - startedAt,
        mimeType: normalizedImage.mimeType,
      },
    };
  } catch (error) {
    return {
      bytes: null,
      mimeType: null,
      attempt: {
        ...attemptBase,
        latencyMs: Date.now() - startedAt,
        errorCode: "FETCH_ERROR",
        errorMessage: String(error).slice(0, 500),
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
  });
  if (first.bytes || params.retryOnFailure === false) {
    return {
      bytes: first.bytes,
      mimeType: first.mimeType,
      prompt: params.prompt,
      promptHash,
      model: params.model,
      estimatedCostUsd: first.attempt.success ? estimatedCostUsd : 0,
      attempts: [first.attempt],
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
  });

  return {
    bytes: retry.bytes,
    mimeType: retry.mimeType,
    prompt: retry.bytes ? retryPrompt : params.prompt,
    promptHash: retry.bytes ? retryPromptHash : promptHash,
    model: params.model,
    estimatedCostUsd: retry.attempt.success ? estimatedCostUsd : 0,
    attempts: [first.attempt, retry.attempt],
  };
}
