import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AiResult = {
  title: string;
  promo_line: string;
  description: string;
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
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");

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

    const { hint_text, price, business_name } = body ?? {};

    if (!hint_text) {
      return new Response(
        JSON.stringify({ error: "Missing hint_text." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!openAiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not set. Please add it to Supabase secrets." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const CHAT_MODEL = resolveOpenAiChatModel();

    const DEFAULT_MONTHLY_LIMIT = Number(Deno.env.get("AI_COPY_MONTHLY_LIMIT") ?? "60");
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: usedThisMonth } = await supabase
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("request_type", "deal_copy")
      .gte("created_at", monthStart.toISOString());
    if (usedThisMonth !== null && usedThisMonth >= DEFAULT_MONTHLY_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Monthly AI copy limit reached. Try again next month." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const prompt = [
      "You create short, mobile-friendly deal copy for a local business.",
      "Keep it punchy, non-cringe, no excessive emojis.",
      "Title <= 50 chars, description <= 160 chars, promo_line <= 60 chars.",
      "Use the hint and optional price, include the business name if helpful.",
      "Return JSON only with title, promo_line, description.",
    ].join(" ");

    const aiBody = {
      model: CHAT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "deal_copy",
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
        },
      },
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Business: ${business_name ?? "Local business"}` },
            { type: "text", text: `Hint: ${hint_text}` },
            { type: "text", text: `Price: ${price ?? "N/A"}` },
          ],
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
      return new Response(
        JSON.stringify({ error: "AI generation failed.", details: text }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiJson = await aiRes.json();
    const usage = aiJson?.usage;
    const content = aiJson?.choices?.[0]?.message?.content ?? "";
    let result: AiResult;
    try {
      result = JSON.parse(content);
    } catch {
      void supabase.from("ai_generation_logs").insert({
        user_id: user.id,
        request_type: "deal_copy",
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
        }
      );
    }

    void supabase.from("ai_generation_logs").insert({
      user_id: user.id,
      request_type: "deal_copy",
      model: CHAT_MODEL,
      success: true,
      openai_called: true,
      input_token_count: usage?.prompt_tokens ?? null,
      output_token_count: usage?.completion_tokens ?? null,
    });

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
