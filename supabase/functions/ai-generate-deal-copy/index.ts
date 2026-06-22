import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { logAiCost } from "../_shared/ai-costs.ts";
import {
  generateStructuredText,
  resolveAiTextProviderConfig,
  type ProviderAttempt,
} from "../_shared/ai-text-provider.ts";
import {
  dealEligibilityErrorPayload,
  validateDealEligibility,
  type DealEligibilityInput,
} from "../../../lib/deal-eligibility.ts";

type AiResult = {
  title: string;
  promo_line: string;
  description: string;
};

const PROMPT_VERSION = "deal_copy_provider_router_v1";

const DEAL_COPY_SCHEMA = {
  name: "deal_copy",
  strict: true,
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      promo_line: { type: "string" },
      description: { type: "string" },
    },
    required: ["title", "promo_line", "description"],
    additionalProperties: false,
  },
} as const;

function normalizeAiResult(value: unknown): AiResult | null {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const promoLine = typeof record.promo_line === "string" ? record.promo_line.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  if (!title || !promoLine || !description) return null;
  return {
    title: title.slice(0, 80),
    promo_line: promoLine.slice(0, 100),
    description: description.slice(0, 220),
  };
}

async function logDealCopyProviderAttempts(params: {
  admin: any;
  businessId: string | null;
  ownerUserId: string;
  requestGroupId: string;
  attempts: readonly ProviderAttempt[];
}) {
  if (!params.businessId) return;
  for (const attempt of params.attempts) {
    await logAiCost(params.admin, {
      businessId: params.businessId,
      ownerUserId: params.ownerUserId,
      requestGroupId: params.requestGroupId,
      feature: "deal_copy",
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

function parseDealEligibilityInput(value: unknown): DealEligibilityInput | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DealEligibilityInput)
    : null;
}

function dealNotEligibleForAiResponse(
  input: DealEligibilityInput | null,
  corsHeaders: Record<string, string>,
) {
  const eligibility = input
    ? validateDealEligibility(input)
    : {
        eligible: false,
        eligibilityStatus: "INVALID" as const,
        reasonCode: "INVALID_DEAL_TYPE" as const,
        message:
          "This deal is not eligible for AI ad generation yet. Twofer deals must be free-item offers or at least 40% off a single item.",
      };
  if (eligibility.eligible) return null;
  return new Response(
    JSON.stringify({
      ...dealEligibilityErrorPayload(eligibility),
      error: "DEAL_NOT_ELIGIBLE_FOR_AI",
      error_code: "DEAL_NOT_ELIGIBLE_FOR_AI",
    }),
    { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey,
      {
        global: {
          headers: {
            Authorization: req.headers.get("Authorization")!,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { hint_text, price, business_name, business_id: bodyBusinessId } = body ?? {};

    if (!hint_text) {
      return new Response(
        JSON.stringify({ error: "Missing hint_text." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const eligibilityResponse = dealNotEligibleForAiResponse(
      parseDealEligibilityInput(body?.deal_eligibility),
      corsHeaders,
    );
    if (eligibilityResponse) return eligibilityResponse;

    let providerConfig;
    try {
      providerConfig = resolveAiTextProviderConfig();
    } catch (err) {
      console.log(JSON.stringify({
        tag: "ai_generate_deal_copy",
        event: "text_provider_config_error",
        err: String(err).slice(0, 200),
      }));
      return new Response(
        JSON.stringify({
          error: "AI copy is temporarily unavailable. Please try again later.",
          error_code: "AI_TEXT_CONFIG_INVALID",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
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
      console.log(JSON.stringify({ tag: "ai_generate_deal_copy", event: "openai_not_configured" }));
      return new Response(
        JSON.stringify({
          error: "AI copy is temporarily unavailable. Please try again later.",
          error_code: "OPENAI_NOT_CONFIGURED",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Look up business for logging/quota (optional body param or fallback to owner lookup)
    let resolvedBusinessId: string | null = typeof bodyBusinessId === "string" ? bodyBusinessId : null;
    if (!resolvedBusinessId) {
      const { data: biz } = await supabase
        .from("businesses")
        .select("id")
        .eq("owner_id", user.id)
        .limit(1)
        .maybeSingle();
      resolvedBusinessId = biz?.id ?? null;
    }

    const requestGroupId = crypto.randomUUID();

    const DEFAULT_MONTHLY_LIMIT = Number(Deno.env.get("AI_COPY_MONTHLY_LIMIT") ?? "30");
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    if (resolvedBusinessId) {
      const { count: usedThisMonth } = await supabase
        .from("ai_generation_logs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", resolvedBusinessId)
        .eq("request_type", "deal_copy")
        .gte("created_at", monthStart.toISOString());
      if (usedThisMonth !== null && usedThisMonth >= DEFAULT_MONTHLY_LIMIT) {
        return new Response(
          JSON.stringify({ error: "Monthly AI copy limit reached. Try again next month." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const prompt = [
      "You write premium ad copy for independent cafés and local food businesses on a mobile deals app called Twofer.",
      "",
      "VOICE & TONE:",
      "- Write like a specialty coffee shop's best marketer — confident, warm, never corporate.",
      "- Lead with what makes the product special: ingredients, process, craft, freshness.",
      "- Use sensory language (\"hand-pulled\", \"stone-ground\", \"slow-steeped\", \"freshly baked\", \"small-batch\").",
      "- Avoid generic ad-speak: no \"best deal ever\", \"amazing offer\", \"you won't believe\", \"act now\", \"don't miss out\".",
      "- Avoid exclamation marks. Confidence doesn't shout.",
      "- The deal should feel like a generous invitation, not a clearance sale.",
      "",
      "STRUCTURE:",
      "- title: Plain-English offer headline. Lead with what the customer gets. <= 50 chars.",
      "- For same-item buy-one-get-one offers, prefer: \"Buy one [item], get one free\".",
      "- Never output \"Same-Item\", \"BOGO\", or internal rule labels in title, promo_line, or description.",
      "- Include size or modifier restrictions in the title only when they materially define the offer.",
      "- Put longer restrictions in description, not the title.",
      "- promo_line: One line that makes the reader feel something. <= 60 chars.",
      "- description: Why this is worth the trip — real ingredients, real care, real deal. <= 160 chars.",
      "- Do not invent missing item names, prices, sizes, or rules.",
      "- Use the hint text and optional price. Weave in the business name naturally if it fits.",
      "- Return JSON only with title, promo_line, description.",
    ].join("\n");

    const userPrompt = [
      `Business: ${business_name ?? "Local business"}`,
      `Hint: ${hint_text}`,
      `Price: ${price ?? "N/A"}`,
    ].join("\n");

    let generation;
    try {
      generation = await generateStructuredText<typeof DEAL_COPY_SCHEMA, AiResult>({
        operation: "creative_candidates",
        systemPrompt: prompt,
        userPrompt,
        jsonSchema: DEAL_COPY_SCHEMA,
        maxOutputTokens: 1024,
        timeoutMs: 12_000,
        generationRunId: requestGroupId,
        promptVersion: PROMPT_VERSION,
        reasoningLevel: "medium",
      }, {
        openAiApiKey: openAiKey,
        geminiApiKey,
        admin: supabase,
        config: providerConfig,
      });
      await logDealCopyProviderAttempts({
        admin: supabase,
        businessId: resolvedBusinessId,
        ownerUserId: user.id,
        requestGroupId,
        attempts: generation.attempts,
      });
    } catch (err) {
      const attempts = (err as { attempts?: ProviderAttempt[] })?.attempts ?? [];
      await logDealCopyProviderAttempts({
        admin: supabase,
        businessId: resolvedBusinessId,
        ownerUserId: user.id,
        requestGroupId,
        attempts,
      });
      const usageAttempt = representativeAttempt(attempts);
      if (resolvedBusinessId) {
        void supabase.from("ai_generation_logs").insert({
          business_id: resolvedBusinessId,
          user_id: user.id,
          request_type: "deal_copy",
          request_hash: `deal_copy:${hint_text.slice(0, 60)}`,
          input_mode: "text",
          model: usageAttempt?.model ?? providerConfig.openAiModel,
          success: false,
          failure_reason:
            (err as { errorCode?: string; errorClass?: string })?.errorCode ??
            (err as { errorClass?: string })?.errorClass ??
            "AI_GENERATION_FAILED",
          openai_called: providerAttemptsCalledOpenAi(attempts),
          input_token_count: usageAttempt?.inputTokens ?? null,
          output_token_count: usageAttempt?.outputTokens ?? null,
        });
      }
      return new Response(
        JSON.stringify({ error: "AI generation failed.", error_code: "AI_GENERATION_FAILED" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const result = normalizeAiResult(generation.value);
    const usageAttempt = representativeAttempt(generation.attempts);
    if (!result) {
      if (resolvedBusinessId) {
        void supabase.from("ai_generation_logs").insert({
          business_id: resolvedBusinessId,
          user_id: user.id,
          request_type: "deal_copy",
          request_hash: `deal_copy:parse_error`,
          input_mode: "text",
          model: generation.model,
          success: false,
          failure_reason: "PARSE_ERROR",
          openai_called: providerAttemptsCalledOpenAi(generation.attempts),
          input_token_count: usageAttempt?.inputTokens ?? null,
          output_token_count: usageAttempt?.outputTokens ?? null,
        });
      }
      return new Response(
        JSON.stringify({ error: "AI response was invalid." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (resolvedBusinessId) {
      void supabase.from("ai_generation_logs").insert({
        business_id: resolvedBusinessId,
        user_id: user.id,
        request_type: "deal_copy",
        request_hash: `deal_copy:${hint_text.slice(0, 60)}`,
        input_mode: "text",
        model: generation.model,
        success: true,
        openai_called: providerAttemptsCalledOpenAi(generation.attempts),
        input_token_count: usageAttempt?.inputTokens ?? null,
        output_token_count: usageAttempt?.outputTokens ?? null,
      });
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
