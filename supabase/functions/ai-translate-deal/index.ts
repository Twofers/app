import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { logAiCost } from "../_shared/ai-costs.ts";
import { countAiQuotaUsage, utcMonthStartIso } from "../_shared/ai-quota-resets.ts";
import { resolveDealTranslateMonthlyLimit } from "../_shared/deal-translate-limit.ts";
import {
  generateStructuredText,
  resolveAiTextProviderConfig,
  type ProviderAttempt,
} from "../_shared/ai-text-provider.ts";
import { getBusinessCapabilities } from "../_shared/business-capabilities.ts";

type AppLocale = "en" | "es" | "ko";

type TranslationResult = {
  source_locale: AppLocale;
  title_en: string;
  title_es: string;
  title_ko: string;
  description_en: string;
  description_es: string;
  description_ko: string;
};

const PROMPT_VERSION = "deal_translation_provider_router_v1";

const DEAL_TRANSLATIONS_SCHEMA = {
  name: "deal_translations",
  strict: true,
  schema: {
    type: "object",
    properties: {
      title_en: { type: "string" },
      title_es: { type: "string" },
      title_ko: { type: "string" },
      description_en: { type: "string" },
      description_es: { type: "string" },
      description_ko: { type: "string" },
    },
    required: ["title_en", "title_es", "title_ko", "description_en", "description_es", "description_ko"],
    additionalProperties: false,
  },
} as const;

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== "string") return null;
  const lang = value.trim().toLowerCase().split("-")[0];
  return lang === "en" || lang === "es" || lang === "ko" ? lang : null;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fallbackResult(title: string, description: string, sourceLocale: AppLocale): TranslationResult {
  return {
    source_locale: sourceLocale,
    title_en: sourceLocale === "en" ? title : "",
    title_es: sourceLocale === "es" ? title : "",
    title_ko: sourceLocale === "ko" ? title : "",
    description_en: sourceLocale === "en" ? description : "",
    description_es: sourceLocale === "es" ? description : "",
    description_ko: sourceLocale === "ko" ? description : "",
  };
}

function normalizeAiResult(raw: unknown, title: string, description: string, sourceLocale: AppLocale): TranslationResult {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const fallback = fallbackResult(title, description, sourceLocale);
  const result: TranslationResult = {
    source_locale: sourceLocale,
    title_en: textField(record.title_en) || fallback.title_en,
    title_es: textField(record.title_es) || fallback.title_es,
    title_ko: textField(record.title_ko) || fallback.title_ko,
    description_en: textField(record.description_en) || fallback.description_en,
    description_es: textField(record.description_es) || fallback.description_es,
    description_ko: textField(record.description_ko) || fallback.description_ko,
  };
  if (sourceLocale === "en") {
    result.title_en = title;
    result.description_en = description;
  } else if (sourceLocale === "es") {
    result.title_es = title;
    result.description_es = description;
  } else {
    result.title_ko = title;
    result.description_ko = description;
  }
  return result;
}

async function logTranslation(
  admin: any,
  input: {
    businessId: string;
    userId: string;
    requestHash: string;
    model: string | null;
    success: boolean;
    openaiCalled: boolean;
    failureReason?: string;
    promptTokens?: number | null;
    completionTokens?: number | null;
  },
) {
  await admin.from("ai_generation_logs").insert({
    business_id: input.businessId,
    user_id: input.userId,
    request_type: "deal_translate",
    request_hash: input.requestHash,
    model: input.model,
    success: input.success,
    failure_reason: input.failureReason ?? null,
    openai_called: input.openaiCalled,
    input_token_count: input.promptTokens ?? null,
    output_token_count: input.completionTokens ?? null,
  });
}

async function logTranslationProviderAttempts(
  admin: any,
  input: {
    businessId: string;
    dealId: string | null;
    userId: string;
    requestGroupId: string;
    attempts: readonly ProviderAttempt[];
  },
) {
  for (const attempt of input.attempts) {
    await logAiCost(admin, {
      businessId: input.businessId,
      dealId: input.dealId,
      ownerUserId: input.userId,
      requestGroupId: input.requestGroupId,
      feature: "deal_translation",
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

function providerAttemptsCalledOpenAi(attempts: readonly ProviderAttempt[]): boolean {
  return attempts.some((attempt) => attempt.provider === "openai");
}

function representativeAttempt(attempts: readonly ProviderAttempt[]): ProviderAttempt | null {
  return attempts.find((attempt) => attempt.success) ?? attempts[attempts.length - 1] ?? null;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Unauthorized. Please log in." }, 401, corsHeaders);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON in request body" }, 400, corsHeaders);
    }

    const dealId = typeof body.deal_id === "string" ? body.deal_id.trim() : "";
    const businessIdFromBody = typeof body.business_id === "string" ? body.business_id.trim() : "";
    const directMode = Boolean(businessIdFromBody && ("title" in body || "description" in body));
    const requestHash = dealId ? `translate:${dealId}` : `translate:direct:${crypto.randomUUID()}`;
    const requestGroupId =
      typeof body.request_group_id === "string" && /^[0-9a-f-]{36}$/i.test(body.request_group_id.trim())
        ? body.request_group_id.trim()
        : crypto.randomUUID();

    let title = "";
    let description = "";
    let businessId = "";
    let sourceLocale = normalizeLocale(body.source_locale) ?? "en";

    if (directMode) {
      businessId = businessIdFromBody;
      title = textField(body.title);
      description = textField(body.description);
    } else {
      if (!dealId) {
        return jsonResponse({ error: "Missing deal_id or business_id/title/description." }, 400, corsHeaders);
      }
      const { data: deal, error: dealErr } = await admin
        .from("deals")
        .select("id, title, description, business_id, source_locale")
        .eq("id", dealId)
        .single();

      if (dealErr || !deal) {
        return jsonResponse({ error: "Deal not found." }, 404, corsHeaders);
      }
      title = deal.title ?? "";
      description = deal.description ?? "";
      businessId = deal.business_id;
      sourceLocale = normalizeLocale(body.source_locale) ?? normalizeLocale(deal.source_locale) ?? "en";
    }

    const { data: biz } = await admin
      .from("businesses")
      .select("owner_id")
      .eq("id", businessId)
      .single();

    if (!biz || biz.owner_id !== user.id) {
      return jsonResponse({ error: "You do not own this business." }, 403, corsHeaders);
    }

    const capabilities = await getBusinessCapabilities(admin as any, businessId);
    if (!capabilities.can_generate_ai) {
      return jsonResponse(
        {
          error: "AI translation unlocks after trial activation.",
          error_code: "BUSINESS_AI_CAPABILITY_REQUIRED",
          reason_code: capabilities.reason_code,
        },
        403,
        corsHeaders,
      );
    }

    if (!title && !description) {
      const emptyResult = fallbackResult("", "", sourceLocale);
      return jsonResponse({ ok: true, skipped: true, ...emptyResult }, 200, corsHeaders);
    }

    // Monthly per-business cap sized at 4x the account's deal-credit allowance
    // (see _shared/deal-translate-limit.ts). When the cap is hit the publish
    // flow falls back to deterministic renderer translations, so deals still
    // publish localized; the direct caller surfaces the message.
    // AI_TRANSLATE_MONTHLY_LIMIT env remains an absolute override.
    const TRANSLATE_MONTHLY_LIMIT = await resolveDealTranslateMonthlyLimit(admin, businessId);
    const { used } = await countAiQuotaUsage(admin, {
      businessId,
      scope: "deal_translate",
      monthStartIso: utcMonthStartIso(),
    });
    if (used >= TRANSLATE_MONTHLY_LIMIT) {
      return jsonResponse(
        { error: "Monthly translation limit reached. Try again next month." },
        429,
        corsHeaders,
      );
    }

    let providerConfig;
    try {
      providerConfig = resolveAiTextProviderConfig();
    } catch {
      console.log(JSON.stringify({
        tag: "ai_translate_deal",
        event: "text_provider_config_error",
        errorCode: "AI_TEXT_CONFIG_INVALID",
      }));
      await logTranslation(admin, {
        businessId,
        userId: user.id,
        requestHash,
        model: null,
        success: false,
        openaiCalled: false,
        failureReason: "AI_TEXT_CONFIG_INVALID",
      });
      return jsonResponse(
        {
          error: "AI translation is temporarily unavailable. Please try again later.",
          error_code: "AI_TEXT_CONFIG_INVALID",
        },
        503,
        corsHeaders,
      );
    }

    const routerCanUseGemini =
      providerConfig.routerEnabled &&
      Boolean(geminiApiKey?.trim()) &&
      (
        providerConfig.primaryProvider === "gemini" ||
        (providerConfig.fallbackEnabled && providerConfig.fallbackProvider === "gemini")
      );

    if (!openAiKey && !routerCanUseGemini) {
      console.log(JSON.stringify({ tag: "ai_translate_deal", event: "openai_not_configured" }));
      await logTranslation(admin, {
        businessId,
        userId: user.id,
        requestHash,
        model: null,
        success: false,
        openaiCalled: false,
        failureReason: "OPENAI_NOT_CONFIGURED",
      });
      return jsonResponse(
        {
          error: "AI translation is temporarily unavailable. Please try again later.",
          error_code: "OPENAI_NOT_CONFIGURED",
        },
        503,
        corsHeaders,
      );
    }

    const systemPrompt = [
      "You translate short promotional deal copy for a local business mobile app.",
      "Supported output locales are English (en), Spanish (es), and Korean (ko).",
      "The owner source locale is provided. For that locale, copy the original text exactly.",
      "For the other locales, translate naturally and preserve the promotional meaning.",
      "Keep translations punchy, mobile-friendly, and similar in length.",
      "Do not add or remove deal terms.",
      "Return JSON only with: title_en, title_es, title_ko, description_en, description_es, description_ko.",
      "If a field is empty, return an empty string for each language version of that field.",
    ].join(" ");

    const userPrompt = `Source locale: ${sourceLocale}\nTitle: ${title}\nDescription: ${description}`;

    let generation;
    try {
      generation = await generateStructuredText<typeof DEAL_TRANSLATIONS_SCHEMA, TranslationResult>({
        operation: "translation",
        systemPrompt,
        userPrompt,
        jsonSchema: DEAL_TRANSLATIONS_SCHEMA,
        maxOutputTokens: 1400,
        timeoutMs: 12_000,
        generationRunId: requestGroupId,
        promptVersion: PROMPT_VERSION,
        reasoningLevel: "medium",
      }, {
        openAiApiKey: openAiKey,
        geminiApiKey,
        admin,
        config: providerConfig,
      });
      await logTranslationProviderAttempts(admin, {
        businessId,
        dealId: dealId || null,
        userId: user.id,
        requestGroupId,
        attempts: generation.attempts,
      });
    } catch (err) {
      const attempts = (err as { attempts?: ProviderAttempt[] })?.attempts ?? [];
      await logTranslationProviderAttempts(admin, {
        businessId,
        dealId: dealId || null,
        userId: user.id,
        requestGroupId,
        attempts,
      });
      const usageAttempt = representativeAttempt(attempts);
      await logTranslation(admin, {
        businessId,
        userId: user.id,
        requestHash,
        model: usageAttempt?.model ?? providerConfig.openAiModel,
        success: false,
        openaiCalled: providerAttemptsCalledOpenAi(attempts),
        failureReason:
          (err as { errorCode?: string; errorClass?: string })?.errorCode ??
          (err as { errorClass?: string })?.errorClass ??
          "AI_GENERATION_FAILED",
        promptTokens: usageAttempt?.inputTokens ?? null,
        completionTokens: usageAttempt?.outputTokens ?? null,
      });
      return jsonResponse(
        { error: "Translation failed.", error_code: "AI_GENERATION_FAILED" },
        502,
        corsHeaders,
      );
    }

    const usageAttempt = representativeAttempt(generation.attempts);
    const result = normalizeAiResult(generation.value, title, description, sourceLocale);

    if (!directMode) {
      const { error: updateErr } = await admin.from("deals").update(result).eq("id", dealId);
      if (updateErr) {
        return jsonResponse({ error: "Translation save failed." }, 500, corsHeaders);
      }
    }

    await logTranslation(admin, {
      businessId,
      userId: user.id,
      requestHash,
      model: generation.model,
      success: true,
      openaiCalled: providerAttemptsCalledOpenAi(generation.attempts),
      promptTokens: usageAttempt?.inputTokens ?? null,
      completionTokens: usageAttempt?.outputTokens ?? null,
    });

    return jsonResponse({ ok: true, ...result }, 200, corsHeaders);
  } catch {
    console.log(JSON.stringify({ tag: "ai_translate_deal", event: "error", errorCode: "SERVER_ERROR" }));
    return jsonResponse({ error: "Server error" }, 500, getCorsHeaders(req));
  }
});
