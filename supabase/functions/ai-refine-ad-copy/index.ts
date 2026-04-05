import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { isDemoUserEmail, type AdVariant, type CreativeLane } from "../ai-generate-ad-variants/demo-variants.ts";

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

// ── Demo refinement engine ─────────────────────────────────
// Detects the user's intent from the instruction and rewrites copy accordingly.

type ToneKey = "fun" | "urgent" | "short" | "formal" | "casual" | "emoji" | "spanish" | "korean" | "savings" | "quality" | "community" | "generic";

const TONE_PATTERNS: [ToneKey, RegExp][] = [
  ["fun", /\b(fun|playful|silly|witty|humor|humour|funny|energetic|lively|cheerful|upbeat)\b/i],
  ["urgent", /\b(urgen|hurry|limited|rush|fast|quick|now|fomo|scarcity|don'?t miss|act fast|last chance)\b/i],
  ["short", /\b(short|brief|concise|trim|fewer words|less text|simpler|minimal|tighter)\b/i],
  ["formal", /\b(formal|professional|polished|elegant|sophisticated|refined|business|classy)\b/i],
  ["casual", /\b(casual|chill|relaxed|laid.?back|friendly|conversational|warm|cozy)\b/i],
  ["emoji", /\b(emoji|emojis|icons|emoticon)\b/i],
  ["spanish", /\b(spanish|español|espanol|en español)\b/i],
  ["korean", /\b(korean|한국어|한글)\b/i],
  ["savings", /\b(saving|value|price|deal|cheap|afford|discount|money|budget|bang for)\b/i],
  ["quality", /\b(quality|craft|artisan|premium|handmade|fresh|ingredient|small.?batch|specialty)\b/i],
  ["community", /\b(community|local|neighbor|neighbourhood|neighborhood|block|corner|regulars|family)\b/i],
];

function detectTone(instruction: string): ToneKey {
  for (const [key, rx] of TONE_PATTERNS) {
    if (rx.test(instruction)) return key;
  }
  return "generic";
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

function extractOfferItem(offer: Record<string, unknown>): string {
  const item =
    (offer.buy_item as string) ||
    (offer.free_item as string) ||
    (offer.item_name as string) ||
    (offer.hint_text as string) ||
    "";
  return item.trim() || "your favorite";
}

function buildDemoRefinedDraft(
  draft: Record<string, unknown>,
  instruction: string,
  offer: Record<string, unknown>,
): AdVariant {
  const tone = detectTone(instruction);
  const lane = (draft.creative_lane as CreativeLane) || "value";
  const origHead = typeof draft.headline === "string" ? draft.headline : "";
  const origSub = typeof draft.subheadline === "string" ? draft.subheadline : "";
  const origCta = typeof draft.cta === "string" ? draft.cta : "";
  const item = extractOfferItem(offer);

  const rewrites: Record<ToneKey, { headline: string; subheadline: string; cta: string; style_label: string; rationale: string; visual_direction: string }> = {
    fun: {
      headline: clip(`Double the ${item}, double the smiles`, 40),
      subheadline: clip(`Bring a friend and treat yourselves — life's too short for just one ${item}!`, 88),
      cta: clip("Let's Go!", 26),
      style_label: "Playful & bright",
      rationale: "Lighthearted energy makes the deal feel like a treat, not a transaction.",
      visual_direction: "Bright colors, candid smiles, hand-drawn accents.",
    },
    urgent: {
      headline: clip(`Today only — BOGO ${item}`, 40),
      subheadline: clip(`Spots are filling up. Grab yours before they're gone.`, 88),
      cta: clip("Claim Now", 26),
      style_label: "Time-sensitive",
      rationale: "Clear urgency drives immediate action without feeling pushy.",
      visual_direction: "Bold countdown feel, high contrast, warm tones.",
    },
    short: {
      headline: clip(`2-for-1 ${item}`, 40),
      subheadline: clip(`Buy one, get one. Simple as that.`, 88),
      cta: clip("Get Yours", 26),
      style_label: "Minimal",
      rationale: "Stripped to the essentials — the offer speaks for itself.",
      visual_direction: "Clean whitespace, bold type, single product shot.",
    },
    formal: {
      headline: clip(`Complimentary ${item} with purchase`, 40),
      subheadline: clip(`We invite you to experience our craftsmanship — enjoy a second ${item} on us.`, 88),
      cta: clip("Redeem Offer", 26),
      style_label: "Polished & refined",
      rationale: "Professional tone elevates the brand without losing warmth.",
      visual_direction: "Serif accents, muted palette, elegant product photography.",
    },
    casual: {
      headline: clip(`Hey, free ${item} on us`, 40),
      subheadline: clip(`Grab a friend, swing by, and enjoy two for the price of one. No catch.`, 88),
      cta: clip("Come On In", 26),
      style_label: "Friendly & relaxed",
      rationale: "Feels like a friend telling you about a deal, not an ad.",
      visual_direction: "Warm lighting, approachable vibe, handwritten feel.",
    },
    emoji: {
      headline: clip(`Buy 1 Get 1 ${item}`, 40),
      subheadline: clip(`Treat yourself and a friend — two ${item}s, one price. What's not to love?`, 88),
      cta: clip("Grab the Deal", 26),
      style_label: "Eye-catching",
      rationale: "Visual flair draws the eye in a busy feed.",
      visual_direction: "Colorful accents, product close-up, pop of orange.",
    },
    spanish: {
      headline: clip(`2x1 en ${item}`, 40),
      subheadline: clip(`Compra uno y llévate otro gratis. Ven con alguien especial.`, 88),
      cta: clip("Canjear ahora", 26),
      style_label: "Oferta directa",
      rationale: "Mensaje claro en español para alcanzar más vecinos.",
      visual_direction: "Colores cálidos, tipografía legible, producto al frente.",
    },
    korean: {
      headline: clip(`${item} 1+1 혜택`, 40),
      subheadline: clip(`하나 사면 하나 더! 친구와 함께 방문하세요.`, 88),
      cta: clip("지금 받기", 26),
      style_label: "깔끔한 혜택",
      rationale: "한국어로 명확하게 전달하여 더 많은 이웃에게 도달합니다.",
      visual_direction: "깔끔한 배경, 제품 강조, 따뜻한 톤.",
    },
    savings: {
      headline: clip(`Save on ${item} — BOGO deal`, 40),
      subheadline: clip(`Why pay for two when you can get one free? Real savings, no strings.`, 88),
      cta: clip("See the Savings", 26),
      style_label: "Value-forward",
      rationale: "Leads with the financial benefit to attract deal-seekers.",
      visual_direction: "Price badge overlay, warm product shot, bold numbers.",
    },
    quality: {
      headline: clip(`Handcrafted ${item}, twice the joy`, 40),
      subheadline: clip(`Every ${item} is made fresh with care. Now enjoy two for the price of one.`, 88),
      cta: clip("Taste the Craft", 26),
      style_label: "Artisan quality",
      rationale: "Highlights the craft behind the product to justify the visit.",
      visual_direction: "Tight crop on texture and detail, natural light, minimal text.",
    },
    community: {
      headline: clip(`Your neighborhood ${item} spot`, 40),
      subheadline: clip(`We're proud to be part of this community. Bring a neighbor — BOGO today.`, 88),
      cta: clip("Stop By", 26),
      style_label: "Local favorite",
      rationale: "Neighborhood warmth turns the deal into a community moment.",
      visual_direction: "Storefront or street context, warm tones, real people.",
    },
    generic: {
      headline: clip(origHead || `BOGO ${item}`, 40),
      subheadline: clip(
        origSub
          ? `${origSub.split(".")[0]}. Freshly updated to match your vision.`
          : `Buy one ${item}, get one free. Updated just for you.`,
        88,
      ),
      cta: clip(origCta || "Claim Yours", 26),
      style_label: "Refreshed",
      rationale: "Applied your feedback while keeping the core offer front and center.",
      visual_direction: "Balanced layout, product hero, clean typography.",
    },
  };

  const r = rewrites[tone];
  return {
    creative_lane: lane,
    headline: r.headline,
    subheadline: r.subheadline,
    cta: r.cta,
    style_label: r.style_label,
    rationale: r.rationale,
    visual_direction: r.visual_direction,
  };
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

    const demoWantsLive =
      Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";

    if (isDemoUserEmail(user.email) && !demoWantsLive) {
      const delay = 500 + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, delay));

      const refined = buildDemoRefinedDraft(
        selected_draft as Record<string, unknown>,
        instruction,
        structured_offer as Record<string, unknown>,
      );

      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "ad_refine",
        input_mode: "chat",
        request_hash: "demo",
        prompt_version: "v1",
        model: "demo-refine",
        success: true,
        openai_called: false,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          draft: refined,
          usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
