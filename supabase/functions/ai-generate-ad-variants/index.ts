import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { DEFAULT_MONTHLY_LIMIT, DEFAULT_COOLDOWN_SEC } from "../_shared/ai-limits.ts";
import { buildDemoAdVariants, isDemoUserEmail } from "./demo-variants.ts";
import { buildAdVariantImagePrompt, tryGeneratePosterPng } from "../_shared/dalle-image.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type BusinessContext = {
  category?: string;
  tone?: string;
  location?: string;
  description?: string;
};

type CreativeLane = "value" | "neighborhood" | "premium";

type AdVariant = {
  creative_lane: CreativeLane;
  headline: string;
  subheadline: string;
  cta: string;
  style_label: string;
  rationale: string;
  visual_direction: string;
  /** AI-generated ad image in deal-photos bucket; set after DALL-E generation */
  poster_storage_path?: string | null;
};

type AdsResult = { ads: AdVariant[] };

const LANE_ORDER: CreativeLane[] = ["value", "neighborhood", "premium"];

const CHAT_MODEL = resolveOpenAiChatModel();
const DEFAULT_MONTHLY = DEFAULT_MONTHLY_LIMIT;
const COOLDOWN_SEC = DEFAULT_COOLDOWN_SEC;

function utcMonthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function normalizeLaneOrder(ads: AdVariant[]): AdVariant[] | null {
  if (!Array.isArray(ads) || ads.length !== 3) return null;
  const byLane = new Map<CreativeLane, AdVariant>();
  for (const a of ads) {
    if (a?.creative_lane && LANE_ORDER.includes(a.creative_lane)) {
      byLane.set(a.creative_lane, a);
    }
  }
  if (byLane.size !== 3) return null;
  return LANE_ORDER.map((lane) => byLane.get(lane)!);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
      return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const business_id = body.business_id as string | undefined;
    const photo_path_raw = body.photo_path as string | undefined;
    const photo_path = typeof photo_path_raw === "string" ? photo_path_raw.trim() : "";
    const structured_offer = body.structured_offer;
    const has_structured_offer =
      structured_offer !== null && structured_offer !== undefined && typeof structured_offer === "object";
    const hint_text = typeof body.hint_text === "string" ? body.hint_text.trim() : "";
    const price = body.price;
    const business_context = (body.business_context ?? {}) as BusinessContext;
    const regeneration_attempt = typeof body.regeneration_attempt === "number" &&
        Number.isFinite(body.regeneration_attempt)
      ? Math.max(0, Math.floor(body.regeneration_attempt))
      : 0;

    /** Matches client guardrail: 1 initial (0) + 2 regenerations (1, 2). */
    const MAX_REGENERATION_ATTEMPT = 2;
    if (regeneration_attempt > MAX_REGENERATION_ATTEMPT) {
      return new Response(
        JSON.stringify({
          error:
            "Regeneration limit reached for this draft. Edit the text below or start a new offer.",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const offer_schedule_summary = typeof body.offer_schedule_summary === "string"
      ? body.offer_schedule_summary.trim().slice(0, 500)
      : "";

    const manual_validation_tag = typeof body.manual_validation_tag === "string"
      ? body.manual_validation_tag.trim().slice(0, 80)
      : "";

    const rawOutLang = typeof body.output_language === "string"
      ? body.output_language.trim().toLowerCase()
      : "en";
    const output_language = rawOutLang === "es" || rawOutLang === "ko" ? rawOutLang : "en";
    const outputLangName = output_language === "es"
      ? "Spanish"
      : output_language === "ko"
      ? "Korean"
      : "English";

    const input_mode_log = photo_path ? "photo_hint" : "structured_offer";

    if (!business_id || (!photo_path && !has_structured_offer)) {
      return new Response(
        JSON.stringify({
          error: "Missing business_id, or provide photo_path and/or structured_offer.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const structuredOfferJson = has_structured_offer ? JSON.stringify(structured_offer) : "";

    const hintForModel =
      hint_text ||
      (has_structured_offer
        ? "Use STRUCTURED OFFER JSON in SECTION A as the only source of items and deal mechanics."
        : "(No owner note — infer the item or dish from the photo only. Propose a strong, honest BOGO, 2-for-1, or free-add-on style offer that matches what you see. If the image is unclear, use a generic honest café/bakery offer and keep copy grounded in the photo.)");

    const { data: business, error: bizErr } = await supabase
      .from("businesses")
      .select("id, owner_id, name")
      .eq("id", business_id)
      .single();

    if (bizErr || !business || business.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "You do not own this business." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const monthStart = utcMonthStartIso();
    const monthlyLimit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;

    const { count: monthCount } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business_id)
      .eq("request_type", "ad_variants")
      .eq("openai_called", true)
      .eq("success", true)
      .gte("created_at", monthStart);

    if ((monthCount ?? 0) >= monthlyLimit) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "ad_variants",
        input_mode: input_mode_log,
        request_hash: "monthly_limit",
        prompt_version: "v1",
        success: false,
        failure_reason: "MONTHLY_LIMIT",
        quota_blocked: true,
        openai_called: false,
      });
      return new Response(
        JSON.stringify({
          error: `Monthly AI limit reached (${monthlyLimit}). Resets on the 1st.`,
          error_code: "MONTHLY_LIMIT",
          quota: { used: monthCount ?? 0, limit: monthlyLimit, remaining: 0 },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cooldownMs = Math.max(10, COOLDOWN_SEC) * 1000;
    const { data: recentCall } = await admin
      .from("ai_generation_logs")
      .select("id")
      .eq("business_id", business_id)
      .eq("request_type", "ad_variants")
      .eq("success", true)
      .gte("created_at", new Date(Date.now() - cooldownMs).toISOString())
      .limit(1)
      .maybeSingle();

    if (recentCall) {
      return new Response(
        JSON.stringify({
          error: "Please wait a moment before generating again.",
          error_code: "COOLDOWN_ACTIVE",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let signedPosterUrl: string | null = null;
    if (photo_path) {
      const { data: signed, error: signedError } = await supabase.storage
        .from("deal-photos")
        .createSignedUrl(photo_path, 60 * 60);

      if (signedError || !signed?.signedUrl) {
        return new Response(JSON.stringify({ error: "Could not access the photo. Upload again." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      signedPosterUrl = signed.signedUrl;
    }

    /** Demo account: default path uses local templates (no OpenAI). Set AI_ADS_DEMO_USE_LIVE=true + OPENAI_API_KEY for live tests. */
    const demoWantsLive = Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";
    if (isDemoUserEmail(user.email)) {
      const useDemoMock = !openAiKey || !demoWantsLive;
      if (useDemoMock) {
        const ms = 900 + Math.floor(Math.random() * 550);
        await new Promise((r) => setTimeout(r, ms));
        const demoAds = buildDemoAdVariants({
          hint_text: hintForModel,
          price,
          business_name: typeof business.name === "string" ? business.name : "",
          business_context,
          offer_schedule_summary,
          output_language,
          regeneration_attempt,
        });
        const demoNorm = normalizeLaneOrder(demoAds as AdVariant[]);
        if (!demoNorm) {
          return new Response(JSON.stringify({ error: "Demo generation failed." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.log(
          JSON.stringify({
            tag: "ai_ads",
            event: "demo_mock_ok",
            user_id: user.id,
            business_id,
            regeneration_attempt,
            manual_validation_tag: manual_validation_tag || null,
            lanes: demoNorm.map((a) => a.creative_lane),
          }),
        );
        await admin.from("ai_generation_logs").insert({
          business_id,
          user_id: user.id,
          request_type: "ad_variants",
          input_mode: input_mode_log,
          request_hash: `demo_mock:${regeneration_attempt}:${
            photo_path ? photo_path.slice(-48) : "structured"
          }`,
          prompt_version: "v1",
          model: "demo_mock",
          success: true,
          openai_called: false,
        });
        return new Response(JSON.stringify({ ads: demoNorm }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!openAiKey) {
      const ms2 = 900 + Math.floor(Math.random() * 550);
      await new Promise((r) => setTimeout(r, ms2));
      const fallbackAds = buildDemoAdVariants({
        hint_text: hintForModel,
        price,
        business_name: typeof business.name === "string" ? business.name : "",
        business_context,
        offer_schedule_summary,
        output_language,
        regeneration_attempt,
      });
      const fallbackNorm = normalizeLaneOrder(fallbackAds as AdVariant[]);
      if (!fallbackNorm) {
        return new Response(JSON.stringify({ error: "Generation failed." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ads: fallbackNorm }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: prior } = await supabase
      .from("deals")
      .select("title, description")
      .eq("business_id", business_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const factLines: string[] = [
      `Business name (display only; do not invent a different business type than the offer implies): ${business.name}`,
    ];
    if (has_structured_offer) {
      factLines.push(
        `STRUCTURED OFFER — CANONICAL JSON (same priority as owner note; do not contradict): ${structuredOfferJson}`,
      );
    }
    factLines.push(
      `OWNER OFFER NOTE — HIGHEST PRIORITY. Every headline, subheadline, and CTA must be consistent with this. Do not invent items, discounts, prices, or times not stated or clearly implied here: ${hintForModel}`,
      `Price field from app (use only if it matches the owner note; otherwise treat as not specified): ${price != null && price !== "" ? String(price) : "not specified"}`,
    );
    if (offer_schedule_summary) {
      factLines.push(
        `OFFER SCHEDULE — same priority as owner note. When times matter, headline or subheadline must reflect this window accurately: ${offer_schedule_summary}`,
      );
    }

    const profileBits: string[] = [];
    if (business_context.category) profileBits.push(`Category hint: ${business_context.category}`);
    if (business_context.tone) profileBits.push(`Tone hint: ${business_context.tone}`);
    if (business_context.location) profileBits.push(`Location hint: ${business_context.location}`);
    if (business_context.description) profileBits.push(`Short business blurb: ${business_context.description}`);

    const userTextParts: string[] = [
      "=== SECTION A: OFFER FACTS (always win; never contradicted by Section B) ===",
      factLines.join("\n"),
    ];

    if (profileBits.length > 0) {
      userTextParts.push(
        "=== SECTION B: OPTIONAL BUSINESS PROFILE (style, vocabulary, neighborhood color only) ===",
        "Use only to sound more like this kind of place. If any hint here conflicts with SECTION A (wrong item, wrong discount, wrong price, wrong time, wrong meal type), IGNORE that part of the profile.",
        profileBits.join("\n"),
      );
    }

    if (prior?.title) {
      userTextParts.push(
        "=== Prior published deal (voice reference only; do not copy wording or revive old offers) ===",
        `"${prior.title}" — ${(prior.description ?? "").slice(0, 100)}`,
      );
    }

    if (manual_validation_tag) {
      userTextParts.push(`=== Manual QA tag (for logs only; ignore for copy) ===\n${manual_validation_tag}`);
    }

    const userText = userTextParts.join("\n\n");

    const regenHint =
      regeneration_attempt > 0
        ? `REGENERATION #${regeneration_attempt}: Use fresh wording vs any typical previous batch. Change at least one headline structure and avoid repeating the same opening words across lanes. Still truthful to the owner note and photo.`
        : "";

    const system = [
      "You write exactly 3 mobile ad concepts for independent cafés and local food businesses on Twofer. Output JSON only.",
      "",
      "VOICE & TONE: Write like the owner's best marketer — warm, confident, never corporate. Use sensory language (\"hand-pulled\", \"small-batch\", \"freshly baked\", \"single-origin\"). Avoid generic ad-speak (\"best deal ever\", \"amazing offer\", \"don't miss out\"). No exclamation marks. The deal should feel like a generous invitation from a craftsperson, not a clearance sale.",
      "",
      `OUTPUT LANGUAGE: Write headline, subheadline, cta, style_label, rationale, and visual_direction entirely in ${outputLangName}. Do not mix languages.`,
      signedPosterUrl
        ? "PRIORITY ORDER: (1) SECTION A offer facts in the user message — structured offer JSON (if present), owner note, schedule, price field (2) the image (3) SECTION B profile hints for tone/voice only."
        : "PRIORITY ORDER: (1) SECTION A offer facts — structured offer JSON (if present), owner note, schedule, price field (2) SECTION B profile hints for tone/voice only. No image is provided; do not invent visual details of a dish.",
      ...(has_structured_offer
        ? [
            "STRUCTURED OFFER ENFORCEMENT: When SECTION A includes structured offer JSON, all three variants must reflect a strong deal only — BOGO or 2-for-1, a free item with purchase, 40%+ off, second-item half off, or the fixed-price special exactly as stated.",
            "Never invent weak percentage discounts (for example 5–35% off) or small savings that contradict the structured JSON or owner note.",
          ]
        : []),
      "Profile category/tone/location/blurb must NOT override item, discount type, price, or time window. If profile says 'bakery' but the offer is clearly about lattes, write for the latte offer.",
      "Each ad MUST set creative_lane to one of: value | neighborhood | premium — use each exactly once.",
      "Lane rules:",
      "• value: savings, 2-for-1, BOGO, price clarity, straightforward benefit. No fake countdowns.",
      "• neighborhood: local pride, regulars; use SECTION B location hint for 'near you' phrasing only if it does not contradict SECTION A.",
      "• premium: quality, ingredients, craft, care — not snobby corporate.",
      "Do not promise what SECTION A and the photo do not support.",
      "Differentiate lanes strongly: a reader should see three strategies, not three rephrasings.",
      "Each of the three headlines must use a visibly different structure: one as a direct question to the reader, one as a clear factual or benefit statement, and one as a two-beat line (setup clause + payoff). Do not reuse the same opening pattern across lanes.",
      "Ban generic phrases: 'best deal ever', 'amazing offer', 'you won't believe', 'act now', 'limited time only' unless the owner note implies a real window.",
      "Do not say 'today only', 'today', or a specific weekday unless the owner note explicitly includes that day or 'today'.",
      "No health, nutrition, or 'best in town' claims unless stated in the owner note.",
      "Headline <= 40 chars. Subheadline <= 88 chars. CTA <= 26 chars, verb-first.",
      "style_label: 2-4 words, specific to that lane (not generic 'Great deal').",
      `rationale: one sentence in ${outputLangName}, why this lane fits this business.`,
      "visual_direction: short art direction for this lane or empty string.",
      regenHint,
    ]
      .filter(Boolean)
      .join(" ");

    const jsonSchema = {
      name: "ad_variants",
      schema: {
        type: "object",
        properties: {
          ads: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: {
              type: "object",
              properties: {
                creative_lane: {
                  type: "string",
                  enum: ["value", "neighborhood", "premium"],
                },
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
          },
        },
        required: ["ads"],
        additionalProperties: false,
      },
    };

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
      { type: "text", text: userText },
    ];
    if (signedPosterUrl) {
      userContent.push({ type: "image_url", image_url: { url: signedPosterUrl, detail: "low" } });
    }

    const aiBody = {
      model: CHAT_MODEL,
      response_format: { type: "json_schema", json_schema: jsonSchema },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: userContent,
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
      console.log(
        JSON.stringify({
          tag: "ai_ads",
          event: "openai_error",
          user_id: user.id,
          regeneration_attempt,
          manual_validation_tag: manual_validation_tag || null,
          status: aiRes.status,
        }),
      );
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "ad_variants",
        input_mode: input_mode_log,
        request_hash: `openai_http_${aiRes.status}`,
        prompt_version: "v1",
        model: CHAT_MODEL,
        success: false,
        failure_reason: `OPENAI_HTTP_${aiRes.status}`,
        openai_called: true,
      });
      return new Response(JSON.stringify({ error: "AI generation failed.", details: text }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const usage = aiJson?.usage;
    if (usage && typeof usage === "object") {
      console.log(
        JSON.stringify({
          tag: "ai_ads",
          event: "token_usage",
          user_id: user.id,
          regeneration_attempt,
          manual_validation_tag: manual_validation_tag || null,
          prompt_tokens: usage.prompt_tokens ?? null,
          completion_tokens: usage.completion_tokens ?? null,
          total_tokens: usage.total_tokens ?? null,
        }),
      );
    }
    const content = aiJson?.choices?.[0]?.message?.content ?? "";
    let parsed: AdsResult;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.log(
        JSON.stringify({
          tag: "ai_ads",
          event: "parse_error",
          user_id: user.id,
          manual_validation_tag: manual_validation_tag || null,
        }),
      );
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "ad_variants",
        input_mode: input_mode_log,
        request_hash: "parse_error",
        prompt_version: "v1",
        model: CHAT_MODEL,
        success: false,
        failure_reason: "PARSE_ERROR",
        openai_called: true,
      });
      return new Response(JSON.stringify({ error: "AI response was invalid JSON." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalized = normalizeLaneOrder(parsed.ads as AdVariant[]);
    if (!normalized) {
      console.log(
        JSON.stringify({
          tag: "ai_ads",
          event: "lane_validation_failed",
          user_id: user.id,
          manual_validation_tag: manual_validation_tag || null,
        }),
      );
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "ad_variants",
        input_mode: input_mode_log,
        request_hash: "lane_validation",
        prompt_version: "v1",
        model: CHAT_MODEL,
        success: false,
        failure_reason: "LANE_VALIDATION",
        openai_called: true,
      });
      return new Response(
        JSON.stringify({ error: "AI returned an invalid set of ads. Tap try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(
      JSON.stringify({
        tag: "ai_ads",
        event: "generation_ok",
        user_id: user.id,
        business_id,
        regeneration_attempt,
        manual_validation_tag: manual_validation_tag || null,
        lanes: normalized.map((a) => a.creative_lane),
        total_tokens: usage?.total_tokens ?? null,
      }),
    );

    await admin.from("ai_generation_logs").insert({
      business_id,
      user_id: user.id,
      request_type: "ad_variants",
      input_mode: input_mode_log,
      request_hash: `live:${regeneration_attempt}:${
        photo_path ? photo_path.slice(-48) : `struct:${structuredOfferJson.slice(0, 120)}`
      }`,
      prompt_version: "v1",
      model: CHAT_MODEL,
      success: true,
      openai_called: true,
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
    });

    // --- DALL-E image generation (3 images in parallel) ---
    const businessNameForImage = typeof business.name === "string" ? business.name : "Local Café";
    let imageSuccessCount = 0;
    try {
      const imageResults = await Promise.allSettled(
        normalized.map((ad) => {
          const prompt = buildAdVariantImagePrompt({
            lane: ad.creative_lane,
            businessName: businessNameForImage,
            headline: ad.headline,
            subheadline: ad.subheadline,
            visualDirection: ad.visual_direction,
          });
          return tryGeneratePosterPng(openAiKey!, prompt, "ai_ads");
        }),
      );
      const ts = Date.now();
      for (let i = 0; i < normalized.length; i++) {
        const result = imageResults[i];
        const png =
          result.status === "fulfilled" ? result.value : null;
        if (!png || png.length < 100) {
          normalized[i].poster_storage_path = null;
          continue;
        }
        const imgPath = `${business_id}/ai_ad_${normalized[i].creative_lane}_${ts}_${i}.png`;
        const { error: upErr } = await admin.storage
          .from("deal-photos")
          .upload(imgPath, png, { contentType: "image/png", upsert: false });
        if (upErr) {
          console.log(
            JSON.stringify({
              tag: "ai_ads",
              event: "image_upload_error",
              lane: normalized[i].creative_lane,
              err: upErr.message?.slice(0, 200),
            }),
          );
          normalized[i].poster_storage_path = null;
        } else {
          normalized[i].poster_storage_path = imgPath;
          imageSuccessCount++;
        }
      }
    } catch (imgErr) {
      console.log(
        JSON.stringify({
          tag: "ai_ads",
          event: "image_gen_batch_error",
          err: String(imgErr).slice(0, 200),
        }),
      );
      // Text variants are still valid — return them without images
      for (const ad of normalized) ad.poster_storage_path = null;
    }

    console.log(
      JSON.stringify({
        tag: "ai_ads",
        event: "image_gen_summary",
        user_id: user.id,
        business_id,
        images_generated: imageSuccessCount,
        images_total: normalized.length,
      }),
    );

    const updatedUsed = (monthCount ?? 0) + 1;
    const quota = { used: updatedUsed, limit: monthlyLimit, remaining: Math.max(0, monthlyLimit - updatedUsed) };

    return new Response(JSON.stringify({ ads: normalized, quota }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
