import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { logAiCost, type AiUsageInput } from "../_shared/ai-costs.ts";
import {
  generateStructuredText,
  resolveAiTextProviderConfig,
  type ProviderAttempt,
} from "../_shared/ai-text-provider.ts";
import {
  generateGeminiAdImageWithTelemetry,
  resolveAiImageProviderConfig,
} from "../_shared/ai-image-provider.ts";
import { getBusinessCapabilities } from "../_shared/business-capabilities.ts";

// Static anchors so Supabase's remote bundler includes the optional JPEG->PNG
// conversion packages used by `_shared/ai-image-provider.ts`.
import "jpeg-js";
import "pngjs";

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
  poster: PosterCreative;
  composition_plan: CompositionPlan;
};

type ImageGenerationResult = {
  path: string | null;
  signedUrl: string | null;
  provider: "gemini" | "none";
  model: string | null;
  endpoint: "models.generateContent" | "disabled";
  estimatedCostUsd: number;
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  promptHash: string | null;
};

type PosterCreative = {
  kicker: string;
  headline: string;
  supportingLine: string;
  offerLine1: string;
  offerLine2: string;
  scarcityLabel: string;
  timeLabel: string;
  cta: "";
};

type CompositionPlan = {
  template: string;
  subjectPlacement: string;
  negativeSpaceRegion: string;
  cropStrategy: string;
  backgroundMood: string;
  contrastRecommendation: string;
};

const PROMPT_VERSION = "ai_studio_draft_v2";
const PIPELINE_VERSION = "ai_studio_draft_dev_v1";
const AI_DEAL_ASSETS_BUCKET = "ai-deal-assets";
const ALLOWED_STYLES = new Set(["Fresh", "Bold", "Premium", "Sunrise", "Macro"]);
const DEFAULT_CTA = "";
const REQUIRED_IMAGE_PROMPT_CLAUSES = [
  "No text.",
  "No letters.",
  "No logo.",
  "No watermark.",
  "Leave negative space for app-rendered copy.",
  "Use a 4:5 mobile composition.",
];
const DRAFT_COPY_SCHEMA = {
  name: "ai_studio_draft_copy",
  strict: true,
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      supporting_copy: { type: "string" },
      kicker: { type: "string" },
      supporting_line: { type: "string" },
      offer_line_1: { type: "string" },
      offer_line_2: { type: "string" },
      image_prompt: { type: "string" },
      layout_recommendation: { type: "string" },
      composition_plan: {
        type: "object",
        properties: {
          template: { type: "string" },
          subjectPlacement: { type: "string" },
          negativeSpaceRegion: { type: "string" },
          cropStrategy: { type: "string" },
          backgroundMood: { type: "string" },
          contrastRecommendation: { type: "string" },
        },
        required: [
          "template",
          "subjectPlacement",
          "negativeSpaceRegion",
          "cropStrategy",
          "backgroundMood",
          "contrastRecommendation",
        ],
        additionalProperties: false,
      },
    },
    required: [
      "headline",
      "supporting_copy",
      "kicker",
      "supporting_line",
      "offer_line_1",
      "offer_line_2",
      "image_prompt",
      "layout_recommendation",
      "composition_plan",
    ],
    additionalProperties: false,
  },
} as const;

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

function posterText(value: unknown, fallback: string, max: number): string {
  const cleaned = stripPosterFiller(typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  const base = cleaned || fallback;
  if (base.length <= max) return base.toUpperCase();
  const clipped = base.slice(0, max + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const wordSafe = lastSpace >= Math.floor(max * 0.58) ? clipped.slice(0, lastSpace) : base.slice(0, max);
  return wordSafe.trim().toUpperCase();
}

function stripPosterBrand(value: string): string {
  return value.replace(/\btwofer\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

function stripAwkwardAnyDeterminer(value: string): string {
  return value.replace(/\b(?:a|an|the|our|your)\s+(any\b)/gi, "$1");
}

function stripPosterFiller(value: string): string {
  return stripAwkwardAnyDeterminer(stripPosterBrand(value))
    .replace(/^try\s+our\b[:\s-]*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizePosterWords(value: string | null | undefined): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9%+\s-]/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

const POSTER_ITEM_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "choice",
  "drink",
  "hot",
  "iced",
  "large",
  "medium",
  "of",
  "one",
  "regular",
  "small",
  "the",
  "your",
]);

const POSTER_ITEM_WORDS = [
  "coffee",
  "latte",
  "espresso",
  "cappuccino",
  "cookie",
  "bagel",
  "sandwich",
  "muffin",
  "croissant",
  "pastry",
  "scone",
  "tea",
  "taco",
  "dessert",
  "entree",
  "pizza",
  "burger",
  "salad",
  "bowl",
  "smoothie",
];

function posterItemLabel(value: string | null | undefined): string {
  const normalized = normalizePosterWords(value);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const known = POSTER_ITEM_WORDS.find((word) => words.includes(word));
  if (known) return known === "drink" && words.includes("coffee") ? "coffee" : known;
  const meaningful = words.filter((word) => !POSTER_ITEM_STOP_WORDS.has(word));
  return meaningful.length > 0 ? meaningful.slice(-2).join(" ") : words.slice(0, 2).join(" ");
}

function productKeyword(productName: string): string {
  return (posterItemLabel(productName) || "offer").toUpperCase().slice(0, 12);
}

function posterRewardLabel(offerTerms: string, productName: string): string {
  const freeMatch = offerTerms.match(/\bfree\s+(?:a|an|one|1)?\s*([a-z0-9][a-z0-9\s-]{1,80})/i);
  const getFreeMatch = offerTerms.match(/\bget\s+(?:a|an|one|1)?\s*([a-z0-9][a-z0-9\s-]{1,80}?)(?:\s+of your choice)?\s+free\b/i);
  const freePhrase = (freeMatch?.[1] ?? getFreeMatch?.[1])
    ?.replace(/\b(?:of your choice|when|with|today|while|for|redeem|only)\b[\s\S]*$/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  const reward = posterItemLabel(freePhrase || offerTerms);
  const product = posterItemLabel(productName);
  if (reward && reward !== product) return reward.toUpperCase().slice(0, 12);
  if (/\bfree\b/i.test(offerTerms)) return "FREE";
  return "";
}

function posterRewardLine(offerTerms: string, productName: string): string {
  const reward = posterRewardLabel(offerTerms, productName);
  if (reward && reward !== "FREE") return `GET 1 ${reward}`;
  if (reward === "FREE") return "GET 1 FREE";
  return "GET 1 MORE";
}

function posterHeadlineFromOffer(productName: string, offerTerms: string): string {
  const product = productKeyword(productName);
  const reward = posterRewardLabel(offerTerms, productName);
  if (reward && reward !== "FREE" && reward !== product) {
    const pair = `${product} + ${reward}`;
    return pair.length <= 22 ? `${pair} BREAK` : pair;
  }
  return `${product} BONUS`;
}

function isBareItemHeadline(value: string, label: string): boolean {
  const normalized = normalizePosterWords(value);
  const labelWords = new Set(normalizePosterWords(label).split(/\s+/).filter(Boolean));
  if (!normalized || labelWords.size === 0 || /[+&]/.test(value)) return false;
  const meaningful = normalized.split(/\s+/).filter((word) => !POSTER_ITEM_STOP_WORDS.has(word));
  return meaningful.length > 0 && meaningful.every((word) => labelWords.has(word));
}

function isWeakPosterHeadline(value: unknown, fallback: PosterCreative): boolean {
  const raw = typeof value === "string" ? value.trim() : "";
  const cleaned = stripPosterFiller(raw);
  if (!cleaned) return true;
  if (/^try\s+our\b/i.test(raw)) return true;
  const productLabel = normalizePosterWords(fallback.offerLine1).replace(/^buy\s+\d+\s+/, "");
  const rewardLabel = normalizePosterWords(fallback.offerLine2).replace(/^get\s+\d+\s+/, "").replace(/^get\s+/, "");
  return isBareItemHeadline(cleaned, productLabel) || isBareItemHeadline(cleaned, rewardLabel);
}

function formatPosterTimeLabel(start: string | null, end: string | null): string {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (!startDate || !endDate || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) {
    return "TODAY";
  }
  const sameDay = startDate.toDateString() === new Date().toDateString();
  const day = sameDay ? "TODAY" : startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  const startText = startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "");
  const endText = endDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "");
  return `${day} | ${startText}-${endText}`.toUpperCase().slice(0, 28);
}

function fallbackCompositionPlan(stylePreset: string): CompositionPlan {
  const plans: Record<string, CompositionPlan> = {
    Fresh: {
      template: "Fresh",
      subjectPlacement: "center-lower",
      negativeSpaceRegion: "upper-left",
      cropStrategy: "hero-close",
      backgroundMood: "bright-teal-studio",
      contrastRecommendation: "light-text",
    },
    Bold: {
      template: "Bold",
      subjectPlacement: "center",
      negativeSpaceRegion: "upper-center",
      cropStrategy: "large-product-cutout",
      backgroundMood: "split-purple-orange",
      contrastRecommendation: "light-text",
    },
    Premium: {
      template: "Premium",
      subjectPlacement: "lower-half",
      negativeSpaceRegion: "upper-third",
      cropStrategy: "dramatic-hero",
      backgroundMood: "dark-cafe-editorial",
      contrastRecommendation: "warm-light-text",
    },
    Sunrise: {
      template: "Sunrise",
      subjectPlacement: "lower-60-percent",
      negativeSpaceRegion: "upper-left",
      cropStrategy: "morning-hero",
      backgroundMood: "blue-gold-sunrise",
      contrastRecommendation: "light-text",
    },
    Macro: {
      template: "Macro",
      subjectPlacement: "full-canvas",
      negativeSpaceRegion: "left-center",
      cropStrategy: "edge-to-edge-close-crop",
      backgroundMood: "high-contrast-macro",
      contrastRecommendation: "white-text-with-shadow",
    },
  };
  return plans[stylePreset] ?? plans.Fresh;
}

function sanitizeCompositionPlan(value: unknown, stylePreset: string): CompositionPlan {
  const fallback = fallbackCompositionPlan(stylePreset);
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    template: posterText(record.template, fallback.template, 24),
    subjectPlacement: posterText(record.subjectPlacement, fallback.subjectPlacement, 36),
    negativeSpaceRegion: posterText(record.negativeSpaceRegion, fallback.negativeSpaceRegion, 36),
    cropStrategy: posterText(record.cropStrategy, fallback.cropStrategy, 36),
    backgroundMood: posterText(record.backgroundMood, fallback.backgroundMood, 42),
    contrastRecommendation: posterText(record.contrastRecommendation, fallback.contrastRecommendation, 42),
  };
}

function fallbackPoster(params: {
  productName: string;
  offerTerms: string;
  startTime: string | null;
  endTime: string | null;
  quantityLimit: number | null;
}): PosterCreative {
  const product = productKeyword(params.productName);
  return {
    kicker: "LOCAL DEAL",
    headline: posterText(posterHeadlineFromOffer(params.productName, params.offerTerms), "LOCAL DEAL", 28),
    supportingLine: "LIMITED-TIME LOCAL DEAL",
    offerLine1: posterText(`BUY 1 ${product}`, "BUY 1", 18),
    offerLine2: posterText(posterRewardLine(params.offerTerms, params.productName), "GET 1 FREE", 20),
    scarcityLabel: "",
    timeLabel: formatPosterTimeLabel(params.startTime, params.endTime),
    cta: DEFAULT_CTA,
  };
}

function sanitizePosterCreative(value: Record<string, unknown>, fallback: PosterCreative): PosterCreative {
  return {
    kicker: posterText(value.kicker, fallback.kicker, 24),
    headline: posterText(isWeakPosterHeadline(value.headline, fallback) ? "" : value.headline, fallback.headline, 28),
    supportingLine: posterText(value.supporting_line, fallback.supportingLine, 42),
    offerLine1: posterText(value.offer_line_1, fallback.offerLine1, 18),
    offerLine2: posterText(value.offer_line_2, fallback.offerLine2, 20),
    scarcityLabel: "",
    timeLabel: fallback.timeLabel,
    cta: DEFAULT_CTA,
  };
}

function fallbackDraft(params: {
  productName: string;
  productDescription: string | null;
  offerType: string;
  offerTerms: string;
  startTime?: string | null;
  endTime?: string | null;
  quantityLimit?: number | null;
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
    poster: fallbackPoster({
      productName: params.productName,
      offerTerms: params.offerTerms,
      startTime: params.startTime ?? null,
      endTime: params.endTime ?? null,
      quantityLimit: params.quantityLimit ?? null,
    }),
    composition_plan: fallbackCompositionPlan(params.stylePreset),
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
  const commercialGuardrails = [
    "Use realistic commercial food photography or an ad-quality local business visual.",
    "Do not render offer text, business name, logo, start time, end time, quantity, price, CTA, deal terms, menu boards, signs, labels, or watermark.",
  ].join(" ");
  return text(`${prompt} ${commercialGuardrails}`, 1400);
}

function sanitizeGeneratedCopy(value: unknown, fallback: string, max: number): string {
  const cleaned = text(value, max);
  return cleaned || fallback;
}

function buildPosterAwareImagePrompt(params: {
  basePrompt: string;
  productName: string;
  stylePreset: string;
  compositionPlan: CompositionPlan;
}): string {
  return text([
    params.basePrompt,
    "",
    "Poster composition plan for the source image:",
    `Style preset: ${params.stylePreset}`,
    `Template: ${params.compositionPlan.template}`,
    `Subject placement: ${params.compositionPlan.subjectPlacement}`,
    `Negative-space region: ${params.compositionPlan.negativeSpaceRegion}`,
    `Crop strategy: ${params.compositionPlan.cropStrategy}`,
    `Background mood: ${params.compositionPlan.backgroundMood}`,
    `Contrast recommendation: ${params.compositionPlan.contrastRecommendation}`,
    "",
    `Hero product: ${params.productName}.`,
    "Create one clear commercial hero food or drink image for a finished 4:5 restaurant advertisement.",
    "The product should occupy approximately 50-65% of the composition when possible.",
    "Keep deliberate negative space for native headline, offer, and time overlays.",
    "Do not include words, letters, numbers, logos, signs, labels, badges, prices, menu boards, CTAs, or watermarks.",
  ].join("\n"), 3000);
}

function representativeAttempt(attempts: readonly ProviderAttempt[]): ProviderAttempt | null {
  return attempts.find((attempt) => attempt.success) ?? attempts[attempts.length - 1] ?? null;
}

function attemptUsage(attempt: ProviderAttempt | null): AiUsageInput | null {
  if (!attempt) return null;
  return {
    input_tokens: attempt.inputTokens,
    output_tokens: attempt.outputTokens,
    input_tokens_details: typeof attempt.cachedInputTokens === "number"
      ? { cached_tokens: attempt.cachedInputTokens }
      : undefined,
  };
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
  const cta = DEFAULT_CTA;

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

async function generateCopyWithTextProvider(params: {
  admin: any;
  openAiKey?: string | null;
  geminiApiKey?: string | null;
  requestGroupId: string;
  input: ReturnType<typeof parseDraftInput>["value"];
}): Promise<{ draft: DraftCreative; attempts: ProviderAttempt[] }> {
  const systemPrompt = [
    "You write concise, factual advertising draft copy for local deals.",
    "Return only JSON matching the schema.",
    "Never alter locked offer facts.",
    "Never place offer text, business names, logos, CTAs, times, quantities, prices, letters, numbers, or watermarks in the image prompt.",
  ].join(" ");
  const userPrompt = [
    "Create draft copy for a local deals app creative preview.",
    "Return poster-sized advertising fields plus image_prompt, layout_recommendation, and composition_plan.",
    "Poster field limits: kicker max 24 chars, headline max 28 chars, supporting_line max 42 chars, offer_line_1 max 18 chars, offer_line_2 max 20 chars.",
    "Use short advertising copy. Do not write a full sentence for offer_line_1 or offer_line_2.",
    "For a BOGO latte offer, prefer lines like BUY 1 LATTE and GET 1 FREE.",
    "The offer facts below are locked. Do not change, reinterpret, round, shorten, translate, or invent product, offer terms, time window, quantity, price, or business name.",
    "Never use the word Twofer in any poster field.",
    "Never use 'Try our' as the kicker or headline. Prefer a compact campaign idea from the full offer, like COFFEE + COOKIE BREAK.",
    "If a locked product starts with 'any', never put a, an, the, our, or your before it. Say BUY 1 COFFEE or BUY ANY LARGE COFFEE DRINK, not BUY AN ANY LARGE COFFEE DRINK.",
    "Headline, kicker, supporting_line, and supporting_copy may be persuasive, but must preserve the locked facts exactly when mentioned.",
    "The image_prompt is for a commercial image only. It must not include offer copy or any text to render.",
    "The image_prompt must explicitly include: no text, no letters, no logo, no watermark, negative space for native overlay copy, and 4:5 mobile composition.",
    "Never include the business name, CTA, offer terms, time, quantity, price, letters, numbers, logo, or watermark in the image prompt.",
    "composition_plan must include template, subjectPlacement, negativeSpaceRegion, cropStrategy, backgroundMood, and contrastRecommendation.",
    "The image should look campaign-quality: one clear hero product, 50-65% product scale when possible, deliberate negative space, strong lighting, no distracting cafe clutter.",
    `Locked product: ${params.input.productName}`,
    `Description: ${params.input.productDescription ?? "none"}`,
    `Locked offer type: ${params.input.offerType}`,
    `Locked offer terms: ${params.input.offerTerms}`,
    `Locked start time: ${params.input.startTime}`,
    `Locked end time: ${params.input.endTime}`,
    `Locked quantity limit: ${params.input.quantityLimit}`,
    `Requested style: ${params.input.stylePreset}`,
  ].join("\n");

  const generation = await generateStructuredText<typeof DRAFT_COPY_SCHEMA, Record<string, unknown>>({
    operation: "creative_candidates",
    systemPrompt,
    userPrompt,
    jsonSchema: DRAFT_COPY_SCHEMA,
    maxOutputTokens: 1600,
    timeoutMs: 12_000,
    generationRunId: params.requestGroupId,
    promptVersion: PROMPT_VERSION,
    reasoningLevel: "low",
  }, {
    openAiApiKey: params.openAiKey,
    geminiApiKey: params.geminiApiKey,
    admin: params.admin,
    config: resolveAiTextProviderConfig(),
  });

  const parsed = generation.value;
  const fallback = fallbackDraft({
    productName: params.input.productName,
    productDescription: params.input.productDescription,
    offerType: params.input.offerType,
    offerTerms: params.input.offerTerms,
    startTime: params.input.startTime,
    endTime: params.input.endTime,
    quantityLimit: params.input.quantityLimit,
    stylePreset: params.input.stylePreset,
  });
  const poster = sanitizePosterCreative(parsed, fallback.poster);
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
      poster,
      composition_plan: sanitizeCompositionPlan(parsed.composition_plan, params.input.stylePreset),
    },
    attempts: generation.attempts,
  };
}

async function generateAndStoreGeminiImage(params: {
  admin: any;
  geminiApiKey?: string | null;
  userId: string;
  businessId: string;
  requestGroupId: string;
  imagePrompt: string;
  productName: string;
  stylePreset: string;
  compositionPlan: CompositionPlan;
}): Promise<ImageGenerationResult> {
  const imageConfig = resolveAiImageProviderConfig();
  if (imageConfig.primaryProvider !== "gemini" || !imageConfig.geminiEnabled) {
    return {
      path: null,
      signedUrl: null,
      provider: "none",
      model: imageConfig.geminiModel,
      endpoint: "disabled",
      estimatedCostUsd: 0,
      success: false,
      errorCode: "GEMINI_IMAGE_DISABLED",
      errorMessage: "Gemini image provider is not enabled.",
      promptHash: null,
    };
  }

  const image = await generateGeminiAdImageWithTelemetry({
    apiKey: params.geminiApiKey,
    model: imageConfig.geminiModel,
    prompt: buildPosterAwareImagePrompt({
      basePrompt: params.imagePrompt,
      productName: params.productName,
      stylePreset: params.stylePreset,
      compositionPlan: params.compositionPlan,
    }),
    aspectRatio: "4:5",
    imageSize: "1K",
    estimatedCostUsd: imageConfig.geminiEstimatedCost1KUsd,
    retryOnFailure: true,
  });
  const attempt = image.attempts.find((item) => item.success) ?? image.attempts[image.attempts.length - 1] ?? null;
  if (!image.bytes || !image.mimeType) {
    return {
      path: null,
      signedUrl: null,
      provider: "gemini",
      model: image.model,
      endpoint: "models.generateContent",
      estimatedCostUsd: 0,
      success: false,
      errorCode: attempt?.errorCode ?? "GEMINI_IMAGE_FAILED",
      errorMessage: attempt?.errorMessage ?? "Gemini returned no image bytes.",
      promptHash: image.promptHash,
    };
  }

  const safeBusinessId = params.businessId.replace(/[^a-zA-Z0-9-]/g, "");
  const safeUserId = params.userId.replace(/[^a-zA-Z0-9-]/g, "");
  const path = `${safeBusinessId}/${safeUserId}/${params.requestGroupId}/creative.png`;
  const imageBuffer = image.bytes.buffer.slice(
    image.bytes.byteOffset,
    image.bytes.byteOffset + image.bytes.byteLength,
  ) as ArrayBuffer;
  const upload = await params.admin.storage.from(AI_DEAL_ASSETS_BUCKET).upload(path, new Blob([imageBuffer], {
    type: image.mimeType,
  }), {
    contentType: image.mimeType,
    upsert: false,
  });
  if (upload.error) {
    return {
      path: null,
      signedUrl: null,
      provider: "gemini",
      model: image.model,
      endpoint: "models.generateContent",
      estimatedCostUsd: image.estimatedCostUsd,
      success: false,
      errorCode: "AI_ASSET_UPLOAD_FAILED",
      errorMessage: upload.error.message.slice(0, 160),
      promptHash: image.promptHash,
    };
  }

  const signed = await params.admin.storage.from(AI_DEAL_ASSETS_BUCKET).createSignedUrl(path, 60 * 20);
  return {
    path,
    signedUrl: signed.data?.signedUrl ?? null,
    provider: "gemini",
    model: image.model,
    endpoint: "models.generateContent",
    estimatedCostUsd: image.estimatedCostUsd,
    success: true,
    errorCode: null,
    errorMessage: null,
    promptHash: image.promptHash,
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

  const capabilities = await getBusinessCapabilities(admin as any, input.businessId);
  if (!capabilities.can_generate_ai) {
    return json(
      req,
      {
        error: "AI generation unlocks after trial activation.",
        error_code: "BUSINESS_AI_CAPABILITY_REQUIRED",
        reason_code: capabilities.reason_code,
      },
      403,
    );
  }

  const requestGroupId = crypto.randomUUID();
  const idempotencyHash = await sha256Hex(JSON.stringify({ userId: user.id, input }));
  const idempotencyKey = `ai-studio-dev:${idempotencyHash.slice(0, 40)}`;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const forceDryRun = bool(Deno.env.get("AI_STUDIO_DRY_RUN"), false);
  const imageGenerationEnabled = bool(Deno.env.get("AI_STUDIO_ENABLE_IMAGE_GENERATION"), false);
  const dryRun = input.dryRun || forceDryRun || !openAiKey;
  const copyOnly = input.copyOnly || !imageGenerationEnabled || dryRun;

  let draft = fallbackDraft({
    productName: input.productName,
    productDescription: input.productDescription,
    offerType: input.offerType,
    offerTerms: input.offerTerms,
    startTime: input.startTime,
    endTime: input.endTime,
    quantityLimit: input.quantityLimit,
    stylePreset: input.stylePreset,
  });
  let provider = "fallback";
  let model = "dry-run-fallback";
  let usage: AiUsageInput | null = null;
  let requestId: string | null = null;
  let estimatedCost = 0;
  let fallbackReason: string | null = dryRun ? "DRY_RUN_OR_MISSING_OPENAI_KEY" : null;

  if (!dryRun && openAiKey) {
    try {
      const generated = await generateCopyWithTextProvider({
        admin,
        openAiKey,
        geminiApiKey,
        requestGroupId,
        input,
      });
      draft = generated.draft;
      const attempt = representativeAttempt(generated.attempts);
      provider = attempt?.provider ?? "openai";
      model = attempt?.model ?? resolveAiTextProviderConfig().openAiModel;
      usage = attemptUsage(attempt);
      requestId = attempt?.provider === "openai" ? attempt.requestId ?? null : null;
      estimatedCost = attempt?.estimatedCostUsd ?? 0;
      fallbackReason = null;
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message.slice(0, 120) : "AI_TEXT_PROVIDER_FAILED";
      if (!input.dryRun && !forceDryRun) {
        return json(req, {
          error: "AI text generation failed.",
          error_code: "AI_TEXT_PROVIDER_FAILED",
          details: fallbackReason,
        }, 502);
      }
    }
  }
  draft.image_prompt = ensureTextFreeImagePrompt(draft.image_prompt, fallbackDraft({
    productName: input.productName,
    productDescription: input.productDescription,
    offerType: input.offerType,
    offerTerms: input.offerTerms,
    startTime: input.startTime,
    endTime: input.endTime,
    quantityLimit: input.quantityLimit,
    stylePreset: input.stylePreset,
  }).image_prompt);
  let imageResult: ImageGenerationResult = {
    path: null,
    signedUrl: null,
    provider: "none",
    model: null,
    endpoint: "disabled",
    estimatedCostUsd: 0,
    success: false,
    errorCode: copyOnly ? "COPY_ONLY" : null,
    errorMessage: null,
    promptHash: null,
  };

  if (!copyOnly) {
    imageResult = await generateAndStoreGeminiImage({
      admin,
      geminiApiKey,
      userId: user.id,
      businessId: input.businessId,
      requestGroupId,
      imagePrompt: draft.image_prompt,
      productName: input.productName,
      stylePreset: input.stylePreset,
      compositionPlan: draft.composition_plan,
    });
    if (imageResult.success) {
      draft.image_asset_path = imageResult.path;
      draft.image_signed_url = imageResult.signedUrl;
    } else {
      fallbackReason = imageResult.errorCode ?? fallbackReason;
    }
  }

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
    sourceAssetPath: draft.image_asset_path,
    sourceAssetSignedUrl: draft.image_signed_url,
    renderedAssetPath: null,
    renderedAssetSignedUrl: null,
    stylePreset: draft.style_preset,
    layoutRecommendation: draft.layout_recommendation,
    poster: draft.poster,
    compositionPlan: draft.composition_plan,
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
    imageProvider: imageResult.provider,
    imageModel: imageResult.model,
    imageGenerationSuccess: imageResult.success,
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
        noImageGeneration: copyOnly,
        privateAssetOnly: draft.image_asset_path !== null ? draft.image_signed_url !== null : true,
        publishingDisabled: true,
        dryRun,
        imageProvider: imageResult.provider,
        imageGenerationSuccess: imageResult.success,
        imageGenerationErrorCode: imageResult.errorCode,
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
    input_token_count: typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
    output_token_count: typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
    estimated_cost_usd: estimatedCost,
    response_payload: {
      job_id: job.id,
      creative_id: creative.id,
      provider,
      model,
      dry_run: dryRun,
      copy_only: copyOnly,
      layout_recommendation: draft.layout_recommendation,
      image_prompt_validated: includesAllImagePromptRequirements(draft.image_prompt),
      image_generation_enabled: imageGenerationEnabled,
      image_provider: imageResult.provider,
      image_model: imageResult.model,
      image_asset_path: draft.image_asset_path,
      source_asset_path: draft.image_asset_path,
      rendered_asset_path: null,
      image_prompt_hash: imageResult.promptHash,
      publishing_disabled: true,
    },
    openai_called: provider === "openai",
    user_agent: req.headers.get("user-agent"),
  });

  if (imageResult.provider === "gemini") {
    await logAiCost(admin, {
      businessId: input.businessId,
      ownerUserId: user.id,
      requestGroupId,
      feature: "ai_studio_image",
      provider: "gemini",
      model: imageResult.model ?? "gemini-image",
      endpoint: imageResult.endpoint,
      estimatedCostUsd: imageResult.estimatedCostUsd,
      success: imageResult.success,
      errorCode: imageResult.errorCode,
      errorMessage: imageResult.errorMessage,
    });
  }

  await logAiCost(admin, {
    businessId: input.businessId,
    ownerUserId: user.id,
    requestGroupId,
    feature: "ai_studio_draft",
    provider,
    model,
    endpoint: provider === "gemini" ? "models.generateContent" : provider === "openai" ? "chat.completions" : "dry_run",
    usage,
    estimatedCostUsd: estimatedCost,
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
      source_asset_path: draft.image_asset_path,
      source_asset_signed_url: draft.image_signed_url,
      rendered_asset_path: null,
      rendered_asset_signed_url: null,
      image_provider: imageResult.provider,
      image_model: imageResult.model,
      image_generation_success: imageResult.success,
      image_generation_error_code: imageResult.errorCode,
      text_provider: provider,
      text_model: model,
      fallback_reason: fallbackReason,
      publishing_disabled: true,
      dry_run: dryRun,
      copy_only: copyOnly,
    },
  });
});
