import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHAT_MODEL = resolveOpenAiChatModel();
const DEFAULT_MONTHLY = Number(Deno.env.get("AI_MONTHLY_LIMIT") ?? "30");

type ChatTurn = { role: string; content: string };

function utcMonthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

serve(async (req) => {
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

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body.", error_code: "BAD_JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const business_id = typeof body.business_id === "string" ? body.business_id.trim() : "";
    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    const structured_offer = body.structured_offer;
    const selected_draft = body.selected_draft;
    const historyRaw = body.conversation_history;

    if (!business_id || !instruction || instruction.length > 2000) {
      return new Response(
        JSON.stringify({ error: "Missing business_id or instruction.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!structured_offer || typeof structured_offer !== "object") {
      return new Response(
        JSON.stringify({ error: "Missing structured_offer.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!selected_draft || typeof selected_draft !== "object") {
      return new Response(
        JSON.stringify({ error: "Missing selected_draft.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id,owner_id")
      .eq("id", business_id)
      .maybeSingle();

    if (bizErr || !biz || biz.owner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Business not found or access denied.", error_code: "FORBIDDEN" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!openAiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not configured.", error_code: "SERVER_CONFIG" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const monthStart = utcMonthStartIso();
    const monthlyLimit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;

    const { count: monthCount } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business_id)
      .in("request_type", ["ad_variants", "ad_refine"])
      .eq("openai_called", true)
      .eq("success", true)
      .gte("created_at", monthStart);

    if ((monthCount ?? 0) >= monthlyLimit) {
      return new Response(
        JSON.stringify({
          error: `Monthly AI limit reached (${monthlyLimit}). Resets on the 1st.`,
          error_code: "MONTHLY_LIMIT",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawOutLang = typeof body.output_language === "string"
      ? body.output_language.trim().toLowerCase()
      : "en";
    const output_language = rawOutLang === "es" || rawOutLang === "ko" ? rawOutLang : "en";
    const outputLangName = output_language === "es"
      ? "Spanish"
      : output_language === "ko"
      ? "Korean"
      : "English";

    const history: ChatTurn[] = Array.isArray(historyRaw)
      ? (historyRaw as unknown[])
        .filter((h): h is ChatTurn =>
          typeof h === "object" && h !== null && "role" in h && "content" in h &&
          typeof (h as ChatTurn).role === "string" && typeof (h as ChatTurn).content === "string"
        )
        .slice(-20)
        .map((h) => ({
          role: h.role === "assistant" ? "assistant" : "user",
          content: h.content.slice(0, 12000),
        }))
      : [];

    const draftJson = JSON.stringify(selected_draft);
    const offerJson = JSON.stringify(structured_offer);

    const system = [
      "You refine mobile ad copy for a local cafe deal app (Twofer). Output JSON only matching the schema.",
      `Write all ad text fields in ${outputLangName}.`,
      "CANONICAL OFFER FACTS (structured_offer JSON below): You MUST keep the same deal mechanics (items, buy/get logic, discount type). Do not add prices, countdowns, or time windows not present in structured_offer.",
      "If the user asks to change what is free, the BOGO pairing, or the paid item, respond by keeping facts unchanged and only adjusting tone — unless they explicitly say to change the offer; then you may adjust copy to match their new wording but never invent a price.",
      "No fake urgency, no 'best in town', no health claims unless in structured_offer.",
      "Keep headline <= 40 chars, subheadline <= 88 chars, CTA <= 26 chars when reasonable.",
      "Apply the user's edit instruction to the current draft while preserving offer truth.",
    ].join(" ");

    const userBlock =
      `STRUCTURED_OFFER_JSON:\n${offerJson}\n\nCURRENT_DRAFT_JSON:\n${draftJson}\n\nEDIT_INSTRUCTION:\n${instruction}`;

    const messages: { role: string; content: string }[] = [
      { role: "system", content: system },
    ];

    for (const turn of history) {
      messages.push({ role: turn.role, content: turn.content.slice(0, 12000) });
    }
    messages.push({ role: "user", content: userBlock });

    const jsonSchema = {
      name: "refined_ad",
      schema: {
        type: "object",
        properties: {
          creative_lane: { type: "string", enum: ["value", "neighborhood", "premium"] },
          headline: { type: "string" },
          subheadline: { type: "string" },
          cta: { type: "string" },
          style_label: { type: "string" },
          rationale: { type: "string" },
          visual_direction: { type: "string" },
        },
        required: [
          "creative_lane",
          "headline",
          "subheadline",
          "cta",
          "style_label",
          "rationale",
          "visual_direction",
        ],
        additionalProperties: false,
      },
    };

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        response_format: { type: "json_schema", json_schema: jsonSchema },
        messages,
        max_tokens: 800,
        temperature: 0.5,
      }),
    });

    if (!aiRes.ok) {
      const _t = await aiRes.text();
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "ad_refine",
        input_mode: "chat",
        request_hash: `http_${aiRes.status}`,
        prompt_version: "v1",
        model: CHAT_MODEL,
        success: false,
        failure_reason: `OPENAI_${aiRes.status}`,
        openai_called: true,
      });
      return new Response(
        JSON.stringify({ error: "AI refine failed. Try again.", error_code: "OPENAI_ERROR" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiRes.json();
    const usage = aiJson?.usage ?? {};
    const content = aiJson?.choices?.[0]?.message?.content ?? "";

    let draft: Record<string, unknown>;
    try {
      draft = typeof content === "string" ? JSON.parse(content) : {};
    } catch {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "ad_refine",
        input_mode: "chat",
        request_hash: "parse_error",
        prompt_version: "v1",
        model: CHAT_MODEL,
        success: false,
        failure_reason: "PARSE_ERROR",
        openai_called: true,
      });
      return new Response(
        JSON.stringify({ error: "AI returned invalid JSON.", error_code: "PARSE_ERROR" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await admin.from("ai_generation_logs").insert({
      business_id,
      user_id: user.id,
      request_type: "ad_refine",
      input_mode: "chat",
      request_hash: "ok",
      prompt_version: "v1",
      model: CHAT_MODEL,
      success: true,
      openai_called: true,
      input_token_count: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
      output_token_count: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        draft,
        usage: {
          prompt_tokens: usage.prompt_tokens ?? null,
          completion_tokens: usage.completion_tokens ?? null,
          total_tokens: usage.total_tokens ?? null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.log(JSON.stringify({ tag: "ai_refine_ad", event: "error", err: String(e) }));
    return new Response(JSON.stringify({ error: "Server error.", error_code: "SERVER" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
