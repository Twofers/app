import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel, chatCompletionTuning } from "../_shared/openai-chat-model.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { logAiCost, openAiRequestIdFromHeaders } from "../_shared/ai-costs.ts";

type AppLocale = "en" | "es" | "ko";
type TransPhrase = { rx: RegExp; es: string; ko: string };

type TranslationResult = {
  source_locale: AppLocale;
  title_en: string;
  title_es: string;
  title_ko: string;
  description_en: string;
  description_es: string;
  description_ko: string;
};

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
  { rx: /2-for-1|two for one|bogo|buy one.+get one/i, es: "2x1 - calidad artesanal", ko: "1+1 - \uC7A5\uC778\uC758 \uD488\uC9C8" },
];

const DESC_TRANS: TransPhrase[] = [
  { rx: /buy one.+get one free/i, es: "Compra uno y lleva otro gratis - hecho con ingredientes de primera", ko: "\uD558\uB098 \uC0AC\uBA74 \uD558\uB098 \uBB34\uB8CC - \uCD5C\uC0C1\uC758 \uC7AC\uB8CC\uB85C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4" },
  { rx: /two for the price of one/i, es: "Dos por el precio de uno - elaborado con esmero", ko: "\uD558\uB098 \uAC00\uACA9\uC5D0 \uB458 - \uC815\uC131\uC744 \uB2F4\uC544" },
  { rx: /walk.?ins? welcome/i, es: "Sin reserva necesaria - bienvenidos siempre", ko: "\uC608\uC57D \uC5C6\uC774 \uBC29\uBB38 \uAC00\uB2A5" },
  { rx: /made fresh|single-origin|hand/i, es: "Preparado fresco con ingredientes reales. Ven y pruebalo.", ko: "\uC2E0\uC120\uD55C \uC7AC\uB8CC\uB85C \uC815\uC131\uC2A4\uB7FD\uAC8C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4. \uC9C1\uC811 \uB9DB\uBCF4\uC138\uC694." },
  { rx: /no catch|no shortcuts/i, es: "Sin trampas, sin atajos - solo calidad real", ko: "\uC870\uAC74 \uC5C6\uC774, \uD0C0\uD611 \uC5C6\uC774 - \uC9C4\uC9DC \uD488\uC9C8\uB9CC" },
];

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

function translateEnglishField(text: string, phrases: TransPhrase[], lang: "es" | "ko"): string {
  if (!text.trim()) return "";
  for (const p of phrases) {
    if (p.rx.test(text)) return p[lang];
  }
  return lang === "es"
    ? `${text} - calidad artesanal, hecho con cuidado`
    : `${text} - \uC7A5\uC778\uC758 \uC815\uC131\uC73C\uB85C \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4`;
}

function fallbackResult(title: string, description: string, sourceLocale: AppLocale): TranslationResult {
  const result: TranslationResult = {
    source_locale: sourceLocale,
    title_en: sourceLocale === "en" ? title : title,
    title_es: sourceLocale === "en" ? translateEnglishField(title, TITLE_TRANS, "es") : title,
    title_ko: sourceLocale === "en" ? translateEnglishField(title, TITLE_TRANS, "ko") : title,
    description_en: sourceLocale === "en" ? description : description,
    description_es: sourceLocale === "en" ? translateEnglishField(description, DESC_TRANS, "es") : description,
    description_ko: sourceLocale === "en" ? translateEnglishField(description, DESC_TRANS, "ko") : description,
  };
  if (sourceLocale === "es") {
    result.title_es = title;
    result.description_es = description;
  }
  if (sourceLocale === "ko") {
    result.title_ko = title;
    result.description_ko = description;
  }
  return result;
}

function normalizeAiResult(raw: Record<string, unknown>, title: string, description: string, sourceLocale: AppLocale): TranslationResult {
  const fallback = fallbackResult(title, description, sourceLocale);
  const result: TranslationResult = {
    source_locale: sourceLocale,
    title_en: textField(raw.title_en) || fallback.title_en,
    title_es: textField(raw.title_es) || fallback.title_es,
    title_ko: textField(raw.title_ko) || fallback.title_ko,
    description_en: textField(raw.description_en) || fallback.description_en,
    description_es: textField(raw.description_es) || fallback.description_es,
    description_ko: textField(raw.description_ko) || fallback.description_ko,
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

    if (!title && !description) {
      const emptyResult = fallbackResult("", "", sourceLocale);
      return jsonResponse({ ok: true, skipped: true, ...emptyResult }, 200, corsHeaders);
    }

    // Monthly per-business cap (section-4 decision: 30 AI generations/month per
    // feature). Mirrors ai-generate-deal-copy. The background caller
    // (translateDeal) swallows this 429 — the deal simply keeps its source text;
    // the direct caller surfaces the message. Override via AI_TRANSLATE_MONTHLY_LIMIT.
    const TRANSLATE_MONTHLY_LIMIT = Number(Deno.env.get("AI_TRANSLATE_MONTHLY_LIMIT") ?? "30");
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: usedThisMonth } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("request_type", "deal_translate")
      .gte("created_at", monthStart.toISOString());
    if (usedThisMonth !== null && usedThisMonth >= TRANSLATE_MONTHLY_LIMIT) {
      return jsonResponse(
        { error: "Monthly translation limit reached. Try again next month." },
        429,
        corsHeaders,
      );
    }

    if (!openAiKey) {
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

    const chatModel = resolveOpenAiChatModel();
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

    const aiBody = {
      model: chatModel,
      response_format: {
        type: "json_schema",
        json_schema: {
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
        },
      },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Source locale: ${sourceLocale}\nTitle: ${title}\nDescription: ${description}`,
        },
      ],
      ...chatCompletionTuning(chatModel, { maxTokens: 1400 }),
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
      console.log(JSON.stringify({ tag: "ai_translate_deal", event: "openai_error", status: aiRes.status }));
      await logAiCost(admin, {
        businessId,
        dealId: dealId || null,
        ownerUserId: user.id,
        requestGroupId,
        feature: "deal_translation",
        model: chatModel,
        endpoint: "chat.completions",
        openaiRequestId: openAiRequestIdFromHeaders(aiRes.headers),
        success: false,
        errorCode: `HTTP_${aiRes.status}`,
        errorMessage: `Translation call failed with HTTP ${aiRes.status}.`,
      });
      await logTranslation(admin, {
        businessId,
        userId: user.id,
        requestHash,
        model: chatModel,
        success: false,
        openaiCalled: true,
        failureReason: `OPENAI_HTTP_${aiRes.status}`,
      });
      return jsonResponse({ error: "Translation failed." }, 502, corsHeaders);
    }

    const aiJson = await aiRes.json();
    const usage = aiJson?.usage;
    const content = aiJson?.choices?.[0]?.message?.content ?? "";
    await logAiCost(admin, {
      businessId,
      dealId: dealId || null,
      ownerUserId: user.id,
      requestGroupId,
      feature: "deal_translation",
      model: chatModel,
      endpoint: "chat.completions",
      usage: usage ?? null,
      openaiRequestId: openAiRequestIdFromHeaders(aiRes.headers),
      responseId: typeof aiJson?.id === "string" ? aiJson.id : null,
      success: true,
    });

    let result: TranslationResult;
    try {
      const parsed = JSON.parse(content);
      result = normalizeAiResult(parsed, title, description, sourceLocale);
    } catch {
      await logTranslation(admin, {
        businessId,
        userId: user.id,
        requestHash: `translate:parse_error:${dealId || crypto.randomUUID()}`,
        model: chatModel,
        success: false,
        openaiCalled: true,
        failureReason: "PARSE_ERROR",
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
      });
      return jsonResponse({ error: "Translation response was invalid." }, 500, corsHeaders);
    }

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
      model: chatModel,
      success: true,
      openaiCalled: true,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
    });

    return jsonResponse({ ok: true, ...result }, 200, corsHeaders);
  } catch (err) {
    console.log(JSON.stringify({ tag: "ai_translate_deal", event: "error", err: String(err) }));
    return jsonResponse({ error: "Server error" }, 500, getCorsHeaders(req));
  }
});
