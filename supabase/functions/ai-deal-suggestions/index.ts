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

type Suggestion = {
  icon: string;
  title: string;
  body: string;
};

type SuggestionResult = {
  suggestions: Suggestion[];
};

const PROMPT_VERSION = "deal_suggestions_provider_router_v1";

const DEAL_SUGGESTIONS_SCHEMA = {
  name: "deal_suggestions",
  strict: true,
  schema: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            icon: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["icon", "title", "body"],
          additionalProperties: false,
        },
      },
    },
    required: ["suggestions"],
    additionalProperties: false,
  },
} as const;

function normalizeSuggestionResult(value: unknown): SuggestionResult | null {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const suggestions = Array.isArray(record.suggestions) ? record.suggestions : [];
  const normalized = suggestions
    .map((item): Suggestion | null => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const icon = typeof row.icon === "string" ? row.icon.trim() : "";
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const body = typeof row.body === "string" ? row.body.trim() : "";
      if (!icon || !title || !body) return null;
      return {
        icon: icon.slice(0, 16),
        title: title.slice(0, 40),
        body: body.slice(0, 120),
      };
    })
    .filter((item): item is Suggestion => item !== null)
    .slice(0, 3);
  return normalized.length > 0 ? { suggestions: normalized } : null;
}

async function logDealSuggestionProviderAttempts(params: {
  admin: any;
  businessId: string;
  ownerUserId: string;
  requestGroupId: string;
  attempts: readonly ProviderAttempt[];
}) {
  for (const attempt of params.attempts) {
    await logAiCost(params.admin, {
      businessId: params.businessId,
      ownerUserId: params.ownerUserId,
      requestGroupId: params.requestGroupId,
      feature: "deal_suggestions",
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
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    });

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
        },
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
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const {
      business_id,
      business_name,
      business_category,
      weekly_claims_by_day,
      top_deal_titles,
      total_claims,
      total_redeems,
      month_deals_launched,
    } = body;

    if (!business_id || typeof business_id !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing business_id." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let providerConfig;
    try {
      providerConfig = resolveAiTextProviderConfig();
    } catch (err) {
      console.log(JSON.stringify({
        tag: "ai_deal_suggestions",
        event: "text_provider_config_error",
        err: String(err).slice(0, 200),
      }));
      return new Response(JSON.stringify({
        error: "AI insights are temporarily unavailable. Please try again later.",
        error_code: "AI_TEXT_CONFIG_INVALID",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const routerCanUseGemini =
      providerConfig.routerEnabled &&
      Boolean(geminiApiKey?.trim()) &&
      (
        providerConfig.primaryProvider === "gemini" ||
        (providerConfig.fallbackEnabled && providerConfig.fallbackProvider === "gemini")
      );

    if (!openAiKey && !routerCanUseGemini) {
      console.log(JSON.stringify({ tag: "ai_deal_suggestions", event: "openai_not_configured" }));
      return new Response(JSON.stringify({
        error: "AI insights are temporarily unavailable. Please try again later.",
        error_code: "OPENAI_NOT_CONFIGURED",
      }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Quota: 30 insight requests per month per business
    const DEFAULT_MONTHLY_LIMIT = Number(
      Deno.env.get("AI_INSIGHTS_MONTHLY_LIMIT") ?? "30",
    );
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const { count: usedThisMonth } = await supabase
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business_id)
      .eq("request_type", "deal_suggestions")
      .gte("created_at", monthStart.toISOString());

    if (usedThisMonth !== null && usedThisMonth >= DEFAULT_MONTHLY_LIMIT) {
      return new Response(
        JSON.stringify({
          error: "Monthly AI insights limit reached. Try again next month.",
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const requestGroupId = crypto.randomUUID();

    // Build context summary for the prompt
    const contextLines: string[] = [];
    if (business_name) contextLines.push(`Business: ${business_name}`);
    if (business_category) contextLines.push(`Category: ${business_category}`);
    if (total_claims != null) contextLines.push(`Total claims this month: ${total_claims}`);
    if (total_redeems != null) contextLines.push(`Total redemptions this month: ${total_redeems}`);
    if (month_deals_launched != null) contextLines.push(`Deals launched this month: ${month_deals_launched}`);
    if (Array.isArray(weekly_claims_by_day) && weekly_claims_by_day.length === 7) {
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const summary = weekly_claims_by_day
        .map((c: number, i: number) => `${days[i]}: ${c}`)
        .join(", ");
      contextLines.push(`Claims by day (last 7 days): ${summary}`);
    }
    if (Array.isArray(top_deal_titles) && top_deal_titles.length > 0) {
      contextLines.push(
        `Recent deal titles: ${(top_deal_titles as string[]).slice(0, 5).join("; ")}`,
      );
    }

    const systemPrompt = [
      "You are a marketing strategist for independent cafés and local food businesses on a deals app called Twofer.",
      "Given their recent deal performance data, generate 2-3 short, actionable suggestions.",
      "",
      "APPROACH:",
      "- Think like a craft-focused brand consultant, not a generic marketing bot.",
      "- Suggestions should help the owner highlight what makes their business special — ingredients, process, sourcing, freshness.",
      "- Be specific and data-driven: reference actual numbers, days, or deal names from the data.",
      "- Frame suggestions around quality and craft: \"Your buy-one-get-one cold brew offer is strong — try a cortado variant\" not \"Try more deals\".",
      "- If claims are low on certain days, suggest targeted quality deals for those days.",
      "- If a deal is performing well, suggest expanding that product line or pairing it with something complementary.",
      "- One suggestion should always encourage storytelling: origin stories, process details, or ingredient highlights that build customer loyalty.",
      "",
      "FORMAT:",
      "- Keep each title under 40 chars and each body under 120 chars.",
      "- For icon, use a single relevant emoji.",
      "- Return JSON only: an object with a suggestions array of objects with icon, title, body.",
    ].join("\n");

    const userPrompt = contextLines.length > 0
      ? contextLines.join("\n")
      : "New business with no deals yet. Suggest starting offers.";

    let generation;
    try {
      generation = await generateStructuredText<typeof DEAL_SUGGESTIONS_SCHEMA, SuggestionResult>({
        operation: "merchant_context",
        systemPrompt,
        userPrompt,
        jsonSchema: DEAL_SUGGESTIONS_SCHEMA,
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
      await logDealSuggestionProviderAttempts({
        admin: supabase,
        businessId: business_id,
        ownerUserId: user.id,
        requestGroupId,
        attempts: generation.attempts,
      });
    } catch (err) {
      const attempts = (err as { attempts?: ProviderAttempt[] })?.attempts ?? [];
      await logDealSuggestionProviderAttempts({
        admin: supabase,
        businessId: business_id,
        ownerUserId: user.id,
        requestGroupId,
        attempts,
      });
      const usageAttempt = representativeAttempt(attempts);
      void supabase.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "deal_suggestions",
        request_hash: "deal_suggestions:api_error",
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
      return new Response(
        JSON.stringify({ error: "AI generation failed.", error_code: "AI_GENERATION_FAILED" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const result = normalizeSuggestionResult(generation.value);
    const usageAttempt = representativeAttempt(generation.attempts);
    if (!result) {
      void supabase.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "deal_suggestions",
        request_hash: "deal_suggestions:parse_error",
        input_mode: "text",
        model: generation.model,
        success: false,
        failure_reason: "PARSE_ERROR",
        openai_called: providerAttemptsCalledOpenAi(generation.attempts),
        input_token_count: usageAttempt?.inputTokens ?? null,
        output_token_count: usageAttempt?.outputTokens ?? null,
      });
      return new Response(
        JSON.stringify({ error: "AI response was invalid." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Log success
    void supabase.from("ai_generation_logs").insert({
      business_id,
      user_id: user.id,
      request_type: "deal_suggestions",
      request_hash: `deal_suggestions:${new Date().toISOString().slice(0, 10)}`,
      input_mode: "text",
      model: generation.model,
      success: true,
      openai_called: providerAttemptsCalledOpenAi(generation.attempts),
      input_token_count: usageAttempt?.inputTokens ?? null,
      output_token_count: usageAttempt?.outputTokens ?? null,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
