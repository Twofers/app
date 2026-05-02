import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, userClient } from "../_shared/auth-clients.ts";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { isDemoUserEmail } from "../ai-generate-ad-variants/demo-variants.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// ── Phrase-based translation engine ─────────────────────────
type TransPhrase = { rx: RegExp; es: string; ko: string };

const TITLE_TRANS: TransPhrase[] = [
  { rx: /2-for-1 oat milk latte/i, es: "2x1 en lattes de leche de avena", ko: "\uADC0\uB9AC \uC6B0\uC720 \uB77C\uB5BC 1+1" },
  { rx: /oat milk latte/i, es: "Latte de leche de avena artesanal", ko: "\uC815\uC131 \uB2F4\uC740 \uADC0\uB9AC \uC6B0\uC720 \uB77C\uB5BC" },
  { rx: /morning pastry pair/i, es: "Combo matutino de reposter\u00EDa", ko: "\uBAA8\uB2DD \uD398\uC774\uC2A4\uD2B8\uB9AC \uD398\uC5B4" },
  { rx: /iced latte happy hour/i, es: "Happy hour de latte helado", ko: "\uC544\uC774\uC2A4 \uB77C\uB5BC \uD574\uD53C\uC544\uC6CC" },
  { rx: /cold brew/i, es: "Cold brew de origen \u00FAnico 2x1", ko: "\uC2F1\uAE00 \uC624\uB9AC\uC9C4 \uCF5C\uB4DC\uBE0C\uB8E8 1+1" },
  { rx: /bakery box bogo/i, es: "Caja de panader\u00EDa 2x1", ko: "\uBCA0\uC774\uCEE4\uB9AC \uBC15\uC2A4 1+1" },
  { rx: /cortado/i, es: "Cortado artesanal, por partida doble", ko: "\uBC14\uB2D0\uB77C \uCF54\uB974\uD0C0\uB3C4 1+1" },
  { rx: /matcha/i, es: "Matcha ceremonial, dos por uno", ko: "\uB9D0\uCC28 \uB77C\uB5BC 1+1" },
  { rx: /croissant/i, es: "Croissant reci\u00E9n horneado, dos por uno", ko: "\uAC13 \uAD6C\uC6B4 \uD06C\uB85C\uC640\uC0C1 1+1" },
  { rx: /muffin/i, es: "Muffin de ar\u00E1ndanos, dos por uno", ko: "\uBE14\uB8E8\uBCA0\uB9AC \uBA38\uD540 1+1" },
  { rx: /handcrafted|crafted with care/i, es: "Hecho a mano con cuidado, por partida doble", ko: "\uC815\uC131 \uB2F4\uC544 \uB9CC\uB4E0, \uB450 \uBC30\uC758 \uAE30\uC068" },
  { rx: /2-for-1|two for one|bogo|buy one.+get one/i, es: "2x1 \u2014 calidad artesanal", ko: "1+1 \u2014 \uC7A5\uC778\uC758 \uD488\uC9C8" },
];

const DESC_TRANS: TransPhrase[] = [
  { rx: /buy one.+get one free/i, es: "Compra uno y lleva otro gratis \u2014 hecho con ingredientes de primera", ko: "\uD558\uB098 \uC0AC\uBA74 \uD558\uB098 \uBB34\uB8CC \u2014 \uCD5C\uC0C1\uC758 \uC7AC\uB8CC\uB85C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4" },
  { rx: /two for the price of one/i, es: "Dos por el precio de uno \u2014 elaborado con esmero", ko: "\uD558\uB098 \uAC00\uACA9\uC5D0 \uB458 \u2014 \uC815\uC131\uC744 \uB2F4\uC544" },
  { rx: /walk.?ins? welcome/i, es: "Sin reserva necesaria \u2014 bienvenidos siempre", ko: "\uC608\uC57D \uC5C6\uC774 \uBC29\uBB38 \uAC00\uB2A5" },
  { rx: /made fresh|single-origin|hand/i, es: "Preparado fresco con ingredientes reales. Ven y pru\u00E9balo.", ko: "\uC2E0\uC120\uD55C \uC7AC\uB8CC\uB85C \uC815\uC131\uC2A4\uB7FD\uAC8C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4. \uC9C1\uC811 \uB9DB\uBCF4\uC138\uC694." },
  { rx: /no catch|no shortcuts/i, es: "Sin trampas, sin atajos \u2014 solo calidad real", ko: "\uC870\uAC74 \uC5C6\uC774, \uD0C0\uD611 \uC5C6\uC774 \u2014 \uC9C4\uC9DC \uD488\uC9C8\uB9CC" },
];

function translateField(text: string, phrases: TransPhrase[], lang: "es" | "ko"): string {
  if (!text.trim()) return "";
  for (const p of phrases) {
    if (p.rx.test(text)) return p[lang];
  }
  return lang === "es"
    ? `${text} \u2014 calidad artesanal, hecho con cuidado`
    : `${text} \u2014 \uC7A5\uC778\uC758 \uC815\uC131\uC73C\uB85C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4`;
}

function buildTranslationResult(title: string, description: string): TranslationResult {
  return {
    title_es: translateField(title, TITLE_TRANS, "es"),
    title_ko: translateField(title, TITLE_TRANS, "ko"),
    description_es: translateField(description, DESC_TRANS, "es"),
    description_ko: translateField(description, DESC_TRANS, "ko"),
  };
}

type TranslationResult = {
  title_es: string;
  title_ko: string;
  description_es: string;
  description_ko: string;
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const openAiKey = Deno.env.get("OPENAI_API_KEY");

    const userSupabase = userClient(req);
    const admin = adminClient();

    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const deal_id = typeof body.deal_id === "string" ? body.deal_id.trim() : "";
    if (!deal_id) {
      return new Response(
        JSON.stringify({ error: "Missing deal_id." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch deal and verify ownership
    const { data: deal, error: dealErr } = await admin
      .from("deals")
      .select("id, title, description, business_id")
      .eq("id", deal_id)
      .single();

    if (dealErr || !deal) {
      return new Response(
        JSON.stringify({ error: "Deal not found." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: biz } = await admin
      .from("businesses")
      .select("owner_id")
      .eq("id", deal.business_id)
      .single();

    if (!biz || biz.owner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "You do not own this deal." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cost control: cap translations per business per month and enforce a per-deal cooldown.
    const monthlyLimit = Number(Deno.env.get("AI_TRANSLATE_MONTHLY_LIMIT") ?? "100");
    const monthStartIso = (() => {
      const d = new Date();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    })();
    const { count: monthlyCount } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", deal.business_id)
      .eq("request_type", "deal_translate")
      .eq("openai_called", true)
      .eq("success", true)
      .gte("created_at", monthStartIso);
    if ((monthlyCount ?? 0) >= monthlyLimit) {
      return new Response(
        JSON.stringify({
          error: `Monthly translation limit reached (${monthlyLimit}). Resets on the 1st.`,
          error_code: "MONTHLY_LIMIT",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const { data: recentForDeal } = await admin
      .from("ai_generation_logs")
      .select("id")
      .eq("business_id", deal.business_id)
      .eq("request_type", "deal_translate")
      .eq("request_hash", `translate:${deal_id}`)
      .gte("created_at", oneMinAgo)
      .limit(1)
      .maybeSingle();
    if (recentForDeal) {
      return new Response(
        JSON.stringify({
          error: "This deal was just translated. Please wait a moment.",
          error_code: "COOLDOWN_ACTIVE",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const title = deal.title ?? "";
    const description = deal.description ?? "";

    if (!title && !description) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Demo account: phrase-based translations
    const demoWantsLive = Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";
    if (isDemoUserEmail(user.email) && !demoWantsLive) {
      const ms = 400 + Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, ms));
      const demoResult = buildTranslationResult(title, description);
      await admin.from("deals").update(demoResult).eq("id", deal_id);
      return new Response(
        JSON.stringify({ ok: true, ...demoResult }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!openAiKey) {
      const ms = 400 + Math.floor(Math.random() * 300);
      await new Promise((r) => setTimeout(r, ms));
      const fallbackResult = buildTranslationResult(title, description);
      await admin.from("deals").update(fallbackResult).eq("id", deal_id);
      return new Response(
        JSON.stringify({ ok: true, ...fallbackResult }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const CHAT_MODEL = resolveOpenAiChatModel();

    const systemPrompt = [
      "You translate short promotional deal copy for a local business mobile app.",
      "Translate into Spanish (es) and Korean (ko).",
      "Keep translations punchy, mobile-friendly, and preserve the promotional tone.",
      "Do not add or remove information. Keep character counts similar to the original.",
      "Return JSON only with: title_es, title_ko, description_es, description_ko.",
      "If a field is empty, return an empty string for its translations.",
    ].join(" ");

    const aiBody = {
      model: CHAT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "deal_translations",
          schema: {
            type: "object",
            properties: {
              title_es: { type: "string" },
              title_ko: { type: "string" },
              description_es: { type: "string" },
              description_ko: { type: "string" },
            },
            required: ["title_es", "title_ko", "description_es", "description_ko"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Title: ${title}\nDescription: ${description}`,
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
      const errText = await aiRes.text();
      console.log(JSON.stringify({ tag: "ai_translate_deal", event: "openai_error", status: aiRes.status }));
      await admin.from("ai_generation_logs").insert({
        business_id: deal.business_id,
        user_id: user.id,
        request_type: "deal_translate",
        request_hash: `translate:${deal_id}`,
        model: CHAT_MODEL,
        success: false,
        failure_reason: `OPENAI_HTTP_${aiRes.status}`,
        openai_called: true,
      });
      return new Response(
        JSON.stringify({ error: "Translation failed." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiRes.json();
    const usage = aiJson?.usage;
    const content = aiJson?.choices?.[0]?.message?.content ?? "";

    let result: TranslationResult;
    try {
      result = JSON.parse(content);
    } catch {
      await admin.from("ai_generation_logs").insert({
        business_id: deal.business_id,
        user_id: user.id,
        request_type: "deal_translate",
        request_hash: `translate:parse_error:${deal_id}`,
        model: CHAT_MODEL,
        success: false,
        failure_reason: "PARSE_ERROR",
        openai_called: true,
        input_token_count: usage?.prompt_tokens ?? null,
        output_token_count: usage?.completion_tokens ?? null,
      });
      return new Response(
        JSON.stringify({ error: "Translation response was invalid." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Write translations to the deal
    await admin.from("deals").update({
      title_es: result.title_es || null,
      title_ko: result.title_ko || null,
      description_es: result.description_es || null,
      description_ko: result.description_ko || null,
    }).eq("id", deal_id);

    // Log success
    await admin.from("ai_generation_logs").insert({
      business_id: deal.business_id,
      user_id: user.id,
      request_type: "deal_translate",
      request_hash: `translate:${deal_id}`,
      model: CHAT_MODEL,
      success: true,
      openai_called: true,
      input_token_count: usage?.prompt_tokens ?? null,
      output_token_count: usage?.completion_tokens ?? null,
    });

    return new Response(
      JSON.stringify({ ok: true, ...result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.log(JSON.stringify({ tag: "ai_translate_deal", event: "error", err: String(err) }));
    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
