import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Suggestion = {
  icon: string;
  title: string;
  body: string;
};

serve(async (req) => {
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

    if (!openAiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not set." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
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

    const CHAT_MODEL = resolveOpenAiChatModel();

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
      "You are an analytics advisor for a small local business running BOGO deals.",
      "Given their recent deal performance data, generate 2-3 short, actionable suggestions.",
      "Each suggestion should be specific, data-driven, and help the owner get more customers.",
      "If claims are low, suggest timing or deal type changes.",
      "If one day has much higher activity, suggest capitalizing on slow days.",
      "If a deal type is popular, suggest similar deals.",
      "Keep each title under 40 chars and each body under 120 chars.",
      "For icon, use a single relevant emoji.",
      "Return JSON only: an array of objects with icon, title, body.",
    ].join(" ");

    const aiBody = {
      model: CHAT_MODEL,
      response_format: {
        type: "json_schema" as const,
        json_schema: {
          name: "deal_suggestions",
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
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: contextLines.length > 0
            ? contextLines.join("\n")
            : "New business with no deals yet. Suggest starting offers.",
        },
      ],
    };

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aiBody),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      void supabase.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "deal_suggestions",
        request_hash: `deal_suggestions:api_error`,
        input_mode: "text",
        model: CHAT_MODEL,
        success: false,
        failure_reason: "API_ERROR",
        openai_called: true,
      });
      return new Response(
        JSON.stringify({ error: "AI generation failed.", details: text }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const aiJson = await aiRes.json();
    const usage = aiJson?.usage;
    const content = aiJson?.choices?.[0]?.message?.content ?? "";

    let result: { suggestions: Suggestion[] };
    try {
      result = JSON.parse(content);
    } catch {
      void supabase.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "deal_suggestions",
        request_hash: "deal_suggestions:parse_error",
        input_mode: "text",
        model: CHAT_MODEL,
        success: false,
        failure_reason: "PARSE_ERROR",
        openai_called: true,
        input_token_count: usage?.prompt_tokens ?? null,
        output_token_count: usage?.completion_tokens ?? null,
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
      model: CHAT_MODEL,
      success: true,
      openai_called: true,
      input_token_count: usage?.prompt_tokens ?? null,
      output_token_count: usage?.completion_tokens ?? null,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (_err) {
    return new Response(
      JSON.stringify({ error: "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
