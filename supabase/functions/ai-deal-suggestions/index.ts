import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { logAiCost } from "../_shared/ai-costs.ts";
import { countAiQuotaUsage, utcMonthStartIso } from "../_shared/ai-quota-resets.ts";
import {
  generateStructuredText,
  resolveAiTextProviderConfig,
  type ProviderAttempt,
} from "../_shared/ai-text-provider.ts";
import { getBusinessCapabilities } from "../_shared/business-capabilities.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

type Suggestion = {
  icon: string;
  title: string;
  body: string;
};

type SuggestionResult = {
  suggestions: Suggestion[];
};

const PROMPT_VERSION = "deal_suggestions_provider_router_v1";

/**
 * Master gate for server-side stats + repetition memory. Default OFF: with this
 * unset (or not "true"), the function keeps trusting the client-supplied
 * weekly_claims_by_day/top_deal_titles/totals fields and the success log stays
 * byte-identical to the pre-hardening shape (no response_payload).
 */
const SUGGESTIONS_V2_ENABLED = Deno.env.get("AI_SUGGESTIONS_V2_ENABLED") === "true";

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

type ServerSideSuggestionContext = {
  weeklyClaimsByDay: number[];
  topDealTitles: string[];
  totalClaims: number;
  totalRedeems: number;
  monthDealsLaunched: number;
};

type DealClaimStatsRow = {
  deal_id: string;
  created_at: string;
  redeemed_at: string | null;
};

/**
 * SUGGESTIONS_V2_ENABLED only: compute the same stats the merchant dashboard
 * shows (mirrors app/(tabs)/dashboard.tsx's loadMetrics — deal_claims joined to
 * deals, last-7-days claims-by-day, current-month totals) directly from the
 * database instead of trusting client-supplied numbers. `supabase` is the
 * caller's RLS-scoped client (Authorization header forwarded), same client the
 * business-ownership check above already used, so this only ever reads rows
 * the authenticated owner can already see.
 */
async function fetchServerSideSuggestionContext(
  supabase: any,
  businessId: string,
): Promise<ServerSideSuggestionContext> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const weekStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  weekStart.setUTCHours(0, 0, 0, 0);
  const fetchLower = weekStart.getTime() < monthStart.getTime() ? weekStart : monthStart;

  const { data: claimsRaw } = await supabase
    .from("deal_claims")
    .select("deal_id,created_at,redeemed_at,deals!inner(business_id)")
    .eq("deals.business_id", businessId)
    .gte("created_at", fetchLower.toISOString());

  const claims = (claimsRaw ?? []) as DealClaimStatsRow[];

  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    dayKeys.push(new Date(now.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  const weekKeyToCount: Record<string, number> = Object.fromEntries(dayKeys.map((k) => [k, 0]));

  let totalClaims = 0;
  let totalRedeems = 0;
  const monthStartMs = monthStart.getTime();
  for (const claim of claims) {
    const dayKey = typeof claim.created_at === "string" ? claim.created_at.slice(0, 10) : "";
    if (dayKey in weekKeyToCount) weekKeyToCount[dayKey] += 1;
    const createdMs = new Date(claim.created_at).getTime();
    if (Number.isFinite(createdMs) && createdMs >= monthStartMs) {
      totalClaims += 1;
      if (claim.redeemed_at) totalRedeems += 1;
    }
  }

  const { count: launchedCount } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gte("created_at", monthStart.toISOString());

  const { data: liveDeals } = await supabase
    .from("deals")
    .select("id,title")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(5);

  const topDealTitles = ((liveDeals ?? []) as { id: string; title: string | null }[])
    .map((deal) => (typeof deal.title === "string" ? deal.title.trim() : ""))
    .filter((title): title is string => title.length > 0);

  return {
    weeklyClaimsByDay: dayKeys.map((key) => weekKeyToCount[key] ?? 0),
    topDealTitles,
    totalClaims,
    totalRedeems,
    monthDealsLaunched: launchedCount ?? 0,
  };
}

/**
 * SUGGESTIONS_V2_ENABLED only: the most recent successful suggestion response
 * this business received, so the prompt can avoid repeating it. Best-effort —
 * a lookup failure must never block generation.
 */
async function fetchPreviousSuggestionTitles(supabase: any, businessId: string): Promise<string[]> {
  try {
    const { data: priorLog } = await supabase
      .from("ai_generation_logs")
      .select("response_payload")
      .eq("business_id", businessId)
      .eq("request_type", "deal_suggestions")
      .eq("success", true)
      .not("response_payload", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const priorSuggestions = (priorLog?.response_payload as { suggestions?: unknown } | null)?.suggestions;
    if (!Array.isArray(priorSuggestions)) return [];
    return priorSuggestions
      .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).title : null))
      .filter((title): title is string => typeof title === "string" && title.trim().length > 0)
      .map((title) => title.trim())
      .slice(0, 5);
  } catch {
    return [];
  }
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
    const supabaseServiceKey = getServiceRoleKey();
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

    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", business_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!business) {
      return new Response(
        JSON.stringify({ error: "Business not found or access denied.", error_code: "FORBIDDEN" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const capabilities = await getBusinessCapabilities(supabase as any, business_id);
    if (!capabilities.can_generate_ai) {
      return new Response(
        JSON.stringify({
          error: "AI insights unlock after trial activation.",
          error_code: "BUSINESS_AI_CAPABILITY_REQUIRED",
          reason_code: capabilities.reason_code,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let providerConfig;
    try {
      providerConfig = resolveAiTextProviderConfig();
    } catch {
      console.log(JSON.stringify({
        tag: "ai_deal_suggestions",
        event: "text_provider_config_error",
        errorCode: "AI_TEXT_CONFIG_INVALID",
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
    const { used } = await countAiQuotaUsage(supabase, {
      businessId: business_id,
      scope: "deal_suggestions",
      monthStartIso: utcMonthStartIso(),
    });

    if (used >= DEFAULT_MONTHLY_LIMIT) {
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

    // SUGGESTIONS_V2_ENABLED: replace the client-supplied stats with numbers
    // computed server-side from tables the caller's ownership was already
    // verified against above, and look up the business's most recent prior
    // suggestions so the prompt can avoid repeating them.
    const serverContext = SUGGESTIONS_V2_ENABLED
      ? await fetchServerSideSuggestionContext(supabase, business_id)
      : null;
    const previousSuggestionTitles = SUGGESTIONS_V2_ENABLED
      ? await fetchPreviousSuggestionTitles(supabase, business_id)
      : [];

    const effectiveWeeklyClaimsByDay = serverContext ? serverContext.weeklyClaimsByDay : weekly_claims_by_day;
    const effectiveTopDealTitles = serverContext ? serverContext.topDealTitles : top_deal_titles;
    const effectiveTotalClaims = serverContext ? serverContext.totalClaims : total_claims;
    const effectiveTotalRedeems = serverContext ? serverContext.totalRedeems : total_redeems;
    const effectiveMonthDealsLaunched = serverContext ? serverContext.monthDealsLaunched : month_deals_launched;

    // Build context summary for the prompt
    const contextLines: string[] = [];
    if (business_name) contextLines.push(`Business: ${business_name}`);
    if (business_category) contextLines.push(`Category: ${business_category}`);
    if (effectiveTotalClaims != null) contextLines.push(`Total claims this month: ${effectiveTotalClaims}`);
    if (effectiveTotalRedeems != null) contextLines.push(`Total redemptions this month: ${effectiveTotalRedeems}`);
    if (effectiveMonthDealsLaunched != null) {
      contextLines.push(`Deals launched this month: ${effectiveMonthDealsLaunched}`);
    }
    if (Array.isArray(effectiveWeeklyClaimsByDay) && effectiveWeeklyClaimsByDay.length === 7) {
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const summary = effectiveWeeklyClaimsByDay
        .map((c: number, i: number) => `${days[i]}: ${c}`)
        .join(", ");
      contextLines.push(`Claims by day (last 7 days): ${summary}`);
    }
    if (Array.isArray(effectiveTopDealTitles) && effectiveTopDealTitles.length > 0) {
      contextLines.push(
        `Recent deal titles: ${(effectiveTopDealTitles as string[]).slice(0, 5).join("; ")}`,
      );
    }
    if (SUGGESTIONS_V2_ENABLED && previousSuggestionTitles.length > 0) {
      contextLines.push(`Previously suggested: ${previousSuggestionTitles.join("; ")}`);
    }

    const systemPrompt = [
      "You are a marketing strategist for independent local businesses on a deals app called Twofer.",
      "Given their recent deal performance data, generate 2-3 short, actionable suggestions.",
      "",
      "APPROACH:",
      "- Think like a practical local-business advisor, not a generic marketing bot.",
      "- Suggestions should help the owner highlight verified strengths from the supplied business and deal data.",
      "- Be specific and data-driven: reference actual numbers, days, or deal names from the data.",
      "- Frame suggestions around offer clarity, timing, product fit, and customer behavior.",
      "- Do not invent ingredients, sourcing, freshness, craft, health, popularity, or availability claims.",
      "- If claims are low on certain days, suggest targeted deals for those days.",
      "- If a deal is performing well, suggest expanding that product line or pairing it with something complementary.",
      "- One suggestion may encourage owner storytelling only when the supplied data supports a real detail to share.",
      ...(SUGGESTIONS_V2_ENABLED
        ? ["- Do not repeat a suggestion equivalent to a deal already running. Do not repeat a suggestion equivalent to one already suggested previously."]
        : []),
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

    // Log success. SUGGESTIONS_V2_ENABLED: also persist the suggestions into
    // response_payload so a later request can read it back as repetition memory
    // (fetchPreviousSuggestionTitles above). Omitted when the flag is off so the
    // logged row shape stays byte-identical to the pre-hardening behavior.
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
      ...(SUGGESTIONS_V2_ENABLED ? { response_payload: result } : {}),
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
