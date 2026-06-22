import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DEFAULT_MONTHLY_LIMIT, DEFAULT_COOLDOWN_SEC as SHARED_COOLDOWN } from "../_shared/ai-limits.ts";
import { logAiCost, openAiRequestIdFromHeaders, type AiUsageInput } from "../_shared/ai-costs.ts";
import {
  generateStructuredText,
  resolveAiTextProviderConfig,
  type ProviderAttempt,
} from "../_shared/ai-text-provider.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";

const PROMPT_VERSION = Deno.env.get("AI_COMPOSE_PROMPT_VERSION")?.trim() || "v1";
const DEFAULT_MONTHLY = DEFAULT_MONTHLY_LIMIT;
const DEFAULT_COOLDOWN_SEC = SHARED_COOLDOWN;
const DEFAULT_DEDUP_SEC = Number(Deno.env.get("AI_DEDUP_WINDOW_SECONDS") ?? "600");

/** Voice transcription (Whisper). */
const WHISPER_MODEL = Deno.env.get("OPENAI_WHISPER_MODEL")?.trim() || "whisper-1";

/** Poster image model resolved inside _shared/dalle-image.ts. */

const OFFER_TYPES = [
  "bogo_same_item",
  "bogo_second_item_half_off",
  "free_add_on_with_purchase",
  "simple_bundle_offer",
] as const;

const COMPOSE_OFFER_SCHEMA = {
  name: "compose_offer",
  strict: false,
  schema: {
    type: "object",
    properties: {
      detected_items: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      low_confidence: { type: "boolean" },
      recommendation_reason: { type: "string" },
      recommended_offer: {
        type: "object",
        properties: {
          offer_type: { type: "string" },
          item_name: { type: "string" },
          display_offer: { type: "string" },
        },
        required: ["offer_type"],
        additionalProperties: true,
      },
      ad_variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            variant_id: { type: "string" },
            headline_en: { type: "string" },
            headline_es: { type: "string" },
            headline_ko: { type: "string" },
            subheadline_en: { type: "string" },
            subheadline_es: { type: "string" },
            subheadline_ko: { type: "string" },
            cta_en: { type: "string" },
            cta_es: { type: "string" },
            cta_ko: { type: "string" },
            style_label: { type: "string" },
            rationale: { type: "string" },
            visual_direction: { type: "string" },
          },
          required: ["variant_id"],
          additionalProperties: true,
        },
      },
    },
    required: ["recommended_offer", "ad_variants"],
    additionalProperties: true,
  },
} as const;

type AiCostContext = {
  admin: any;
  businessId: string;
  ownerUserId: string;
  requestGroupId: string;
};

async function logComposeCost(
  ctx: AiCostContext,
  input: {
    feature: string;
    model: string;
    endpoint: string;
    provider?: string;
    usage?: AiUsageInput | null;
    audioSeconds?: number;
    estimatedCostUsd?: number;
    openaiRequestId?: string | null;
    responseId?: string | null;
    success?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  await logAiCost(ctx.admin, {
    businessId: ctx.businessId,
    ownerUserId: ctx.ownerUserId,
    requestGroupId: ctx.requestGroupId,
    ...input,
  });
}

function providerAttemptsCalledAi(attempts: readonly ProviderAttempt[]): boolean {
  return attempts.length > 0;
}

function representativeAttempt(attempts: readonly ProviderAttempt[]): ProviderAttempt | null {
  return attempts.find((attempt) => attempt.success) ?? attempts[attempts.length - 1] ?? null;
}

async function logComposeProviderAttempts(params: {
  ctx: AiCostContext;
  attempts: readonly ProviderAttempt[];
}): Promise<void> {
  for (const attempt of params.attempts) {
    await logComposeCost(params.ctx, {
      feature: "compose_offer",
      provider: attempt.provider,
      model: attempt.model,
      endpoint: attempt.provider === "gemini" ? "models.generateContent" : "chat.completions",
      estimatedCostUsd: attempt.estimatedCostUsd,
      openaiRequestId: attempt.provider === "openai" ? attempt.requestId ?? null : null,
      success: attempt.success,
      errorCode: attempt.errorCode ?? attempt.errorClass ?? null,
      errorMessage: attempt.errorClass ?? null,
    });
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function utcMonthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function normalizePrompt(parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);
}

function parseComposeImageInput(imageBase64: string): { bytes: Uint8Array; mimeType: string } | null {
  const mimeType = imageBase64.startsWith("data:")
    ? imageBase64.split(";")[0].replace("data:", "").trim() || "image/jpeg"
    : "image/jpeg";
  const encoded = imageBase64.includes(",") ? imageBase64.split(",")[1] ?? "" : imageBase64;
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    return bytes.length > 0 ? { bytes, mimeType } : null;
  } catch {
    return null;
  }
}

function estimateAudioSecondsFromBase64(base64Audio: string): number {
  const rawChars = base64Audio.includes(",") ? base64Audio.split(",").at(-1) ?? "" : base64Audio;
  const approxBytes = Math.floor((rawChars.length * 3) / 4);
  return Math.max(1, Math.ceil(approxBytes / 16_000));
}

async function transcribeAudio(openAiKey: string, base64Audio: string): Promise<{
  text: string;
  usage: AiUsageInput | null;
  openaiRequestId: string | null;
  responseId: string | null;
}> {
  const raw = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));
  const blob = new Blob([raw], { type: "audio/m4a" });
  const form = new FormData();
  form.append("file", blob, "clip.m4a");
  form.append("model", WHISPER_MODEL);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper provider request failed with HTTP_${res.status}.`);
  }
  const j = await res.json();
  return {
    text: typeof j.text === "string" ? j.text.trim() : "",
    usage: j?.usage ?? null,
    openaiRequestId: openAiRequestIdFromHeaders(res.headers),
    responseId: typeof j?.id === "string" ? j.id : null,
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed", error_code: "METHOD" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  const userClient = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in.", error_code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body.", error_code: "BAD_JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const business_id = body.business_id as string | undefined;
    if (!business_id) {
      return new Response(
        JSON.stringify({ error: "Missing business_id.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id,name,category,tone,location,address,short_description,owner_id")
      .eq("id", business_id)
      .maybeSingle();

    if (bizErr || !biz || biz.owner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Business not found or access denied.", error_code: "FORBIDDEN" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const nameOk = typeof biz.name === "string" && biz.name.trim().length > 0;
    const addrText =
      (typeof biz.address === "string" && biz.address.trim()) ||
      (typeof biz.location === "string" && biz.location.trim()) ||
      "";
    const locOk = addrText.length > 0;
    if (!nameOk || !locOk) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode: "blocked",
        request_hash: "profile",
        prompt_version: PROMPT_VERSION,
        success: false,
        failure_reason: "PROFILE_INCOMPLETE",
        quota_blocked: false,
        duplicate_blocked: false,
        openai_called: false,
      });
      return new Response(
        JSON.stringify({
          error: "Complete your business name and street or location before using AI.",
          error_code: "PROFILE_INCOMPLETE",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const promptTextRaw = typeof body.prompt_text === "string" ? body.prompt_text.trim() : "";
    const voiceTranscriptIn = typeof body.voice_transcript === "string" ? body.voice_transcript.trim() : "";
    const imageBase64 = typeof body.image_base64 === "string" ? body.image_base64.trim() : "";
    const audioBase64 = typeof body.audio_base64 === "string" ? body.audio_base64.trim() : "";
    const transcribeOnly = body.transcribe_only === true;
    const generate_poster_image = body.generate_poster_image === true;

    if (transcribeOnly) {
      if (!audioBase64 || audioBase64.length > 700_000) {
        return new Response(
          JSON.stringify({ error: "Record a short voice note and try again.", error_code: "INVALID_INPUT" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!openAiKey) {
        const th = await sha256Hex(audioBase64.slice(0, 4000));
        await admin.from("ai_generation_logs").insert({
          business_id,
          user_id: user.id,
          request_type: "voice_transcribe",
          input_mode: "voice",
          request_hash: th,
          prompt_version: PROMPT_VERSION,
          model: WHISPER_MODEL,
          success: false,
          failure_reason: "OPENAI_KEY_MISSING",
          openai_called: false,
        });
        return new Response(
          JSON.stringify({
            error: "Voice transcription is temporarily unavailable. Please contact support.",
            error_code: "OPENAI_KEY_MISSING",
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const transcribeCooldownMs = 15_000;
      const { data: recentTx } = await admin
        .from("ai_generation_logs")
        .select("id")
        .eq("business_id", business_id)
        .eq("request_type", "voice_transcribe")
        .gte("created_at", new Date(Date.now() - transcribeCooldownMs).toISOString())
        .limit(1)
        .maybeSingle();
      if (recentTx) {
        return new Response(
          JSON.stringify({
            error: "Please wait a moment before transcribing again.",
            error_code: "COOLDOWN_ACTIVE",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const audioSeconds = typeof body.audio_duration_seconds === "number" && Number.isFinite(body.audio_duration_seconds)
        ? Math.max(0, body.audio_duration_seconds)
        : estimateAudioSecondsFromBase64(audioBase64);
      const costContext: AiCostContext = {
        admin,
        businessId: business_id,
        ownerUserId: user.id,
        requestGroupId: crypto.randomUUID(),
      };
      try {
        const txResult = await transcribeAudio(openAiKey, audioBase64);
        await logComposeCost(costContext, {
          feature: "voice_transcription",
          model: WHISPER_MODEL,
          endpoint: "audio.transcriptions",
          usage: txResult.usage,
          audioSeconds,
          openaiRequestId: txResult.openaiRequestId,
          responseId: txResult.responseId,
          success: true,
        });
        const tx = txResult.text;
        const th = await sha256Hex(audioBase64.slice(0, 4000));
        await admin.from("ai_generation_logs").insert({
          business_id,
          user_id: user.id,
          request_type: "voice_transcribe",
          input_mode: "voice",
          prompt_text: tx || null,
          request_hash: th,
          prompt_version: PROMPT_VERSION,
          model: WHISPER_MODEL,
          success: true,
          openai_called: true,
        });
        return new Response(
          JSON.stringify({ ok: true, transcript: tx }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (e) {
        console.log(JSON.stringify({ tag: "ai_compose", event: "whisper_error" }));
        await logComposeCost(costContext, {
          feature: "voice_transcription",
          model: WHISPER_MODEL,
          endpoint: "audio.transcriptions",
          audioSeconds,
          success: false,
          errorCode: "TRANSCRIPTION_FAILED",
          errorMessage: "Whisper provider request failed.",
        });
        return new Response(
          JSON.stringify({
            error: "Voice transcription failed.",
            error_code: "TRANSCRIPTION_FAILED",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    let promptText = promptTextRaw;
    const combinedText = normalizePrompt([promptText, voiceTranscriptIn]);
    const hasImage = imageBase64.length > 0;
    const hasText = combinedText.length > 0;

    if (!hasImage && !hasText) {
      return new Response(
        JSON.stringify({
          error: "Add a photo, type a request, or record a voice note.",
          error_code: "INVALID_INPUT",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (imageBase64.length > 1_200_000) {
      return new Response(
        JSON.stringify({ error: "Image is too large. Try a smaller photo.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const imageInput = hasImage ? parseComposeImageInput(imageBase64) : null;
    if (hasImage && !imageInput) {
      return new Response(
        JSON.stringify({ error: "Image could not be read. Try a different photo.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let providerConfig;
    try {
      providerConfig = resolveAiTextProviderConfig();
    } catch {
      console.log(JSON.stringify({
        tag: "ai_compose",
        event: "text_provider_config_error",
        errorCode: "AI_TEXT_CONFIG_INVALID",
      }));
      return new Response(
        JSON.stringify({
          error: "AI compose is temporarily unavailable. Please contact support.",
          error_code: "AI_TEXT_CONFIG_INVALID",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const routerCanUseGemini =
      providerConfig.routerEnabled &&
      Boolean(geminiApiKey?.trim()) &&
      (
        providerConfig.primaryProvider === "gemini" ||
        (providerConfig.fallbackEnabled && providerConfig.fallbackProvider === "gemini")
      );
    const configuredComposeModel =
      providerConfig.primaryProvider === "gemini" ? providerConfig.geminiTextModel : providerConfig.openAiModel;

    const input_mode = hasImage && hasText ? "mixed" : hasImage ? "image_only" : "text_only";
    const request_hash = await sha256Hex(
      JSON.stringify({
        b: business_id,
        i: hasImage ? await sha256Hex(imageBase64.slice(0, 2000)) : "",
        t: combinedText.slice(0, 4000),
      }),
    );

    const now = Date.now();
    const cooldownMs = Math.max(10, DEFAULT_COOLDOWN_SEC) * 1000;
    const dedupMs = Math.max(60, DEFAULT_DEDUP_SEC) * 1000;
    const monthStart = utcMonthStartIso();

    const { data: dupRow } = await admin
      .from("ai_generation_logs")
      .select("id,response_payload")
      .eq("business_id", business_id)
      .eq("request_type", "compose_offer")
      .eq("request_hash", request_hash)
      .eq("success", true)
      .not("response_payload", "is", null)
      .gte("created_at", new Date(now - dedupMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dupRow?.response_payload) {
      const dupOf = dupRow.id;
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        voice_transcript: voiceTranscriptIn || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        model: configuredComposeModel,
        success: true,
        duplicate_blocked: true,
        duplicate_of_log_id: dupOf,
        openai_called: false,
        response_payload: dupRow.response_payload,
        low_confidence: !!(dupRow.response_payload as Record<string, unknown>)?.low_confidence,
      });

      const usedOpenAi = await admin
        .from("ai_generation_logs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business_id)
        .eq("request_type", "compose_offer")
        .eq("openai_called", true)
        .eq("success", true)
        .gte("created_at", monthStart);

      const limit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;
      const used = usedOpenAi.count ?? 0;

      return new Response(
        JSON.stringify({
          ok: true,
          duplicate_cached: true,
          result: dupRow.response_payload,
          quota: { used, limit, remaining: Math.max(0, limit - used) },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: recentCooldown } = await admin
      .from("ai_generation_logs")
      .select("id")
      .eq("business_id", business_id)
      .eq("request_type", "compose_offer")
      .eq("success", true)
      .gte("created_at", new Date(now - cooldownMs).toISOString())
      .limit(1)
      .maybeSingle();

    if (recentCooldown) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        success: false,
        failure_reason: "COOLDOWN_ACTIVE",
        openai_called: false,
      });
      return new Response(
        JSON.stringify({
          error: "Please wait a moment before generating again.",
          error_code: "COOLDOWN_ACTIVE",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { count: monthlyCount } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business_id)
      .eq("request_type", "compose_offer")
      .eq("openai_called", true)
      .eq("success", true)
      .gte("created_at", monthStart);

    const limit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;
    const used = monthlyCount ?? 0;
    if (used >= limit) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        success: false,
        failure_reason: "QUOTA_EXCEEDED",
        quota_blocked: true,
        openai_called: false,
      });
      return new Response(
        JSON.stringify({
          error: "Monthly AI generation limit reached.",
          error_code: "QUOTA_EXCEEDED",
          quota: { used, limit, remaining: 0 },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!openAiKey && !routerCanUseGemini) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        voice_transcript: voiceTranscriptIn || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        model: configuredComposeModel,
        success: false,
        failure_reason: "OPENAI_KEY_MISSING",
        openai_called: false,
        response_payload: {
          result_source: "unavailable",
          reason: "OPENAI_KEY_MISSING",
        },
      });
      return new Response(
        JSON.stringify({
          error: "AI compose is temporarily unavailable. Please contact support.",
          error_code: "OPENAI_KEY_MISSING",
          quota: { used, limit, remaining: Math.max(0, limit - used) },
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const costContext: AiCostContext = {
      admin,
      businessId: business_id,
      ownerUserId: user.id,
      requestGroupId: crypto.randomUUID(),
    };

    const systemPrompt = [
      "You help local cafés and small businesses draft ONE promotional offer and TWO short ad variants for the same offer.",
      `Allowed offer_type values only: ${OFFER_TYPES.join(", ")}.`,
      "",
      "VOICE & TONE — this is advertising for independent, craft-focused businesses:",
      "- Write like the owner's best marketer — warm, confident, never corporate or salesy.",
      "- Lead with what makes the product special: ingredients, process, freshness, care.",
      "- Use sensory language: \"hand-pulled\", \"small-batch\", \"stone-ground\", \"freshly baked\", \"single-origin\".",
      "- The deal should feel like a generous invitation from a craftsperson, not a clearance sale.",
      "- Avoid generic ad-speak: no \"best deal ever\", \"amazing offer\", \"you won't believe\", \"act now\", \"don't miss out\".",
      "- Avoid exclamation marks. Confidence doesn't shout.",
      "- Variant A should lead with craft/quality. Variant B should lead with neighborly warmth.",
      "",
      "SHORTHAND INTERPRETATION — very important:",
      "- 'item1 + item2' (two items joined by +) always means: buy item1, get item2 FREE.",
      "  Example: 'coffee + muffin' → 'Buy a coffee and get a free muffin'.",
      "  Example: 'latte + cookie' → 'Buy a latte and get a free cookie'.",
      "  Use offer_type 'free_add_on_with_purchase' for these.",
      "- A single item with no offer context → recommend a same-item buy-one-get-one offer (internal offer_type bogo_same_item).",
      "",
      "MISSPELLING HANDLING — very important:",
      "- Owners type quickly and make typos. Infer the correct item from context.",
      "  Example: 'cofee' → coffee, 'mufin' → muffin, 'latt' → latte, 'espreso' → espresso.",
      "- If a word is unrecognisable, use your best guess and set low_confidence: true.",
      "",
      "DEAL QUALITY — every output MUST qualify as a strong deal:",
      "- Always output a deal that is either: (a) something FREE, (b) buy one, get one free, or (c) 40%+ off.",
      "- NEVER output conditional discounts like 'buy X + N% off Y' — that fails our quality check.",
      "- If the input implies a partial discount, upgrade it to a free-item offer instead.",
      "",
      "Rules:",
      "- Never invent prices. If no price is given, omit price language or say price varies.",
      "- Never invent menu items not visible in the image or stated in text.",
      "- If the user clearly states the offer (e.g. buy one latte, get one free), keep that offer; use image only as supporting context.",
      "- Never output \"BOGO\" or \"Same-Item\" in display_offer or recommendation text.",
      "- If input is vague, recommend one sensible offer from allowed types.",
      "- Output valid JSON only, no markdown.",
      "- ad_variants must contain exactly 2 objects; same underlying offer, different copy style (tone/framing).",
      "- Each variant: variant_id 'A' or 'B', headline_en/es/ko (<=42 chars), subheadline_* (<=80), cta_* (<=24), style_label, rationale, visual_direction.",
      "- Include detected_items array (strings).",
      "- confidence 0-1. low_confidence true if unsure; add recommendation_reason.",
      "- recommended_offer: offer_type, item_name, display_offer (short plain sentence describing the deal clearly).",
    ].join("\n");

    const userPrompt = [
      `Business: ${biz.name}. Category: ${biz.category ?? "n/a"}. Location: ${biz.location}.`,
      biz.short_description ? `About: ${biz.short_description}` : "",
      combinedText ? `Owner request:\n${combinedText}` : "No text request; infer from image only.",
    ]
      .filter(Boolean)
      .join("\n");

    let generation;
    try {
      generation = await generateStructuredText<typeof COMPOSE_OFFER_SCHEMA, Record<string, unknown>>({
        operation: "compose_offer",
        systemPrompt,
        userPrompt,
        imageInputs: imageInput ? [imageInput] : undefined,
        jsonSchema: COMPOSE_OFFER_SCHEMA,
        maxOutputTokens: 1200,
        timeoutMs: 12_000,
        generationRunId: costContext.requestGroupId,
        promptVersion: PROMPT_VERSION,
        reasoningLevel: "medium",
      }, {
        openAiApiKey: openAiKey,
        geminiApiKey,
        admin,
        config: providerConfig,
      });
      await logComposeProviderAttempts({ ctx: costContext, attempts: generation.attempts });
    } catch (err) {
      const attempts = (err as { attempts?: ProviderAttempt[] })?.attempts ?? [];
      await logComposeProviderAttempts({ ctx: costContext, attempts });
      const usageAttempt = representativeAttempt(attempts);
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        model: usageAttempt?.model ?? configuredComposeModel,
        success: false,
        failure_reason:
          (err as { errorCode?: string; errorClass?: string })?.errorCode ??
          (err as { errorClass?: string })?.errorClass ??
          "AI_GENERATION_FAILED",
        openai_called: providerAttemptsCalledAi(attempts),
        input_token_count: usageAttempt?.inputTokens ?? null,
        output_token_count: usageAttempt?.outputTokens ?? null,
        estimated_cost_usd: usageAttempt?.estimatedCostUsd ?? null,
      });
      return new Response(
        JSON.stringify({
          error: "AI service error. Try again shortly.",
          error_code: "AI_GENERATION_FAILED",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parsed = generation.value && typeof generation.value === "object"
      ? generation.value as Record<string, unknown>
      : {};
    const usageAttempt = representativeAttempt(generation.attempts);
    const inTok = usageAttempt?.inputTokens ?? null;
    const outTok = usageAttempt?.outputTokens ?? null;
    const estCost = usageAttempt?.estimatedCostUsd ?? null;

    const variants = parsed.ad_variants;
    const offer = parsed.recommended_offer as Record<string, unknown> | undefined;
    if (!Array.isArray(variants) || variants.length !== 2 || !offer?.offer_type) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        model: generation.model,
        success: false,
        failure_reason: "INVALID_AI_SHAPE",
        openai_called: providerAttemptsCalledAi(generation.attempts),
        input_token_count: inTok,
        output_token_count: outTok,
        estimated_cost_usd: estCost,
        response_payload: parsed,
      });
      return new Response(
        JSON.stringify({
          error: "AI returned an unexpected format. Try again.",
          error_code: "PARSE_ERROR",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const low = !!parsed.low_confidence;
    const offerType = String(offer.offer_type);
    const logPayload = { ...parsed, input_type: input_mode } as Record<string, unknown>;

    const poster_storage_path: string | null = null;
    if (generate_poster_image) {
      logPayload.poster_image_unavailable = true;
      logPayload.poster_disabled_reason = "native_text_rendering_required";
    }

    await admin.from("ai_generation_logs").insert({
      business_id,
      user_id: user.id,
      request_type: "compose_offer",
      input_mode,
      prompt_text: combinedText || null,
      voice_transcript: voiceTranscriptIn || null,
      request_hash,
      prompt_version: PROMPT_VERSION,
      model: generation.model,
      success: true,
      openai_called: providerAttemptsCalledAi(generation.attempts),
      low_confidence: low,
      recommended_offer_type: offerType,
      input_token_count: inTok,
      output_token_count: outTok,
      estimated_cost_usd: estCost,
      response_payload: logPayload,
    });

    const newUsed = used + 1;
    return new Response(
      JSON.stringify({
        ok: true,
        duplicate_cached: false,
        result: logPayload,
        poster_storage_path,
        quota: { used: newUsed, limit, remaining: Math.max(0, limit - newUsed) },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch {
    console.error(JSON.stringify({ tag: "ai_compose", event: "unhandled_error", errorCode: "INTERNAL" }));
    return new Response(
      JSON.stringify({
        error: "We couldn't compose that offer right now. Please try again.",
        error_code: "INTERNAL",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
