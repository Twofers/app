import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, userClient } from "../_shared/auth-clients.ts";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { DEFAULT_MONTHLY_LIMIT, DEFAULT_COOLDOWN_SEC as SHARED_COOLDOWN } from "../_shared/ai-limits.ts";
import { isDemoUserEmail } from "../ai-generate-ad-variants/demo-variants.ts";
import { buildPosterImagePrompt, tryGeneratePosterPng } from "../_shared/dalle-image.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const PROMPT_VERSION = Deno.env.get("AI_COMPOSE_PROMPT_VERSION")?.trim() || "v1";
const DEFAULT_MONTHLY = DEFAULT_MONTHLY_LIMIT;
const DEFAULT_COOLDOWN_SEC = SHARED_COOLDOWN;
const DEFAULT_DEDUP_SEC = Number(Deno.env.get("AI_DEDUP_WINDOW_SECONDS") ?? "600");

/** Compose + vision JSON uses OPENAI_MODEL from Edge secrets (allowlisted in _shared). */
const MODEL = resolveOpenAiChatModel();

/** Voice transcription (Whisper). */
const WHISPER_MODEL = Deno.env.get("OPENAI_WHISPER_MODEL")?.trim() || "whisper-1";

/** Poster image model resolved inside _shared/dalle-image.ts. */

const OFFER_TYPES = [
  "bogo_same_item",
  "bogo_second_item_half_off",
  "free_add_on_with_purchase",
  "simple_bundle_offer",
] as const;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function utcMonthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function normalizePrompt(parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);
}


async function transcribeAudio(openAiKey: string, base64Audio: string): Promise<string> {
  const raw = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));
  const blob = new Blob([raw], { type: "audio/m4a" });
  const form = new FormData();
  form.append("file", blob, "clip.m4a");
  form.append("model", WHISPER_MODEL);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Whisper failed: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return typeof j.text === "string" ? j.text.trim() : "";
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed", error_code: "METHOD" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const openAiKey = Deno.env.get("OPENAI_API_KEY");

  const userSupabase = userClient(req);

  const admin = adminClient();

  try {
    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser();
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

    const business_id = body.business_id as string | undefined;
    if (!business_id) {
      return new Response(
        JSON.stringify({ error: "Missing business_id.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id,name,category,tone,location,address,short_description,owner_id")
      .eq("id", business_id)
      .maybeSingle();

    if (bizErr || !biz || biz.owner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Business not found or access denied.", error_code: "FORBIDDEN" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const nameOk = typeof biz.name === "string" && biz.name.trim().length > 0;
    const addrText =
      (typeof biz.address === "string" && biz.address.trim()) ||
      (typeof biz.location === "string" && biz.location.trim()) ||
      "";
    const locOk = addrText.length > 0;
    if (!nameOk || !locOk) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode: "blocked",
        request_hash: "profile",
        prompt_version: PROMPT_VERSION,
        success: false,
        failure_reason: "PROFILE_INCOMPLETE",
        quota_blocked: false,
        duplicate_blocked: false,
        openai_called: false,
      });
      return new Response(
        JSON.stringify({
          error: "Complete your business name and street or location before using AI.",
          error_code: "PROFILE_INCOMPLETE",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const promptTextRaw = typeof body.prompt_text === "string" ? body.prompt_text.trim() : "";
    const voiceTranscriptIn = typeof body.voice_transcript === "string" ? body.voice_transcript.trim() : "";
    const imageBase64 = typeof body.image_base64 === "string" ? body.image_base64.trim() : "";
    const audioBase64 = typeof body.audio_base64 === "string" ? body.audio_base64.trim() : "";
    const transcribeOnly = body.transcribe_only === true;
    const generate_poster_image = body.generate_poster_image === true;

    // Demo account: return quality-tone results without calling OpenAI
    const demoWantsLive = Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";
    if (isDemoUserEmail(user.email) && !demoWantsLive) {
      const ms = 800 + Math.floor(Math.random() * 600);
      await new Promise((r) => setTimeout(r, ms));

      if (transcribeOnly) {
        return new Response(
          JSON.stringify({ ok: true, transcript: promptTextRaw || "oat milk latte special — freshly pulled" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const rawInput = (promptTextRaw || voiceTranscriptIn || "").toLowerCase();
      const demoHasImage = imageBase64.length > 0;
      const demoHasText = (promptTextRaw + voiceTranscriptIn).trim().length > 0;

      // Detect item from input
      type ComposeItem = { item: string; offerType: string; display: string };
      const itemMap: [RegExp, ComposeItem][] = [
        [/oat\s*milk\s*latte|latte/i, { item: "oat milk latte", offerType: "bogo_same_item", display: "Buy one oat milk latte, get one free" }],
        [/cortado|espresso/i, { item: "vanilla cortado", offerType: "bogo_same_item", display: "Buy one vanilla cortado, get one free" }],
        [/cold\s*brew|iced/i, { item: "single-origin cold brew", offerType: "bogo_same_item", display: "Buy one cold brew, get one free" }],
        [/matcha|green\s*tea/i, { item: "matcha latte", offerType: "bogo_same_item", display: "Buy one matcha latte, get one free" }],
        [/croissant/i, { item: "butter croissant", offerType: "bogo_same_item", display: "Buy one butter croissant, get one free" }],
        [/muffin|blueberry/i, { item: "blueberry muffin", offerType: "bogo_same_item", display: "Buy one blueberry muffin, get one free" }],
        [/pastry|baked/i, { item: "pastry", offerType: "bogo_same_item", display: "Buy one pastry, get one free" }],
        [/combo|pair|\+|and a|with a/i, { item: "latte + pastry", offerType: "free_add_on_with_purchase", display: "Free pastry with any latte purchase" }],
      ];
      let matched: ComposeItem = { item: "oat milk latte", offerType: "bogo_same_item", display: "Buy one oat milk latte, get one free" };
      for (const [rx, ci] of itemMap) { if (rx.test(rawInput)) { matched = ci; break; } }

      const demoResult = {
        detected_items: [matched.item],
        confidence: 0.92,
        low_confidence: false,
        recommendation_reason: `A quality ${matched.item} BOGO highlights your craft and brings new faces through the door.`,
        recommended_offer: {
          offer_type: matched.offerType,
          item_name: matched.item,
          display_offer: matched.display,
        },
        ad_variants: [
          {
            variant_id: "A",
            headline_en: `Handcrafted ${matched.item}, doubled`,
            headline_es: `${matched.item} artesanal, por partida doble`,
            headline_ko: `정성 담은 ${matched.item} 1+1`,
            subheadline_en: `Every ${matched.item} is made fresh with single-origin beans and real ingredients. Now enjoy two for the price of one.`,
            subheadline_es: `Cada ${matched.item} se prepara con granos de origen único e ingredientes reales. Ahora disfruta dos por el precio de uno.`,
            subheadline_ko: `싱글 오리진 원두와 신선한 재료로 만든 ${matched.item}. 하나 가격에 둘을 즐기세요.`,
            cta_en: "Taste the craft",
            cta_es: "Prueba la calidad",
            cta_ko: "장인의 맛 경험하기",
            style_label: "Quality-led",
            rationale: "Leads with craftsmanship to position the deal as a premium experience, not a discount.",
            visual_direction: "Tight crop on product texture, natural light, minimal text overlay.",
          },
          {
            variant_id: "B",
            headline_en: `Made with care at Demo Roasted Bean`,
            headline_es: `Hecho con cariño en Demo Roasted Bean`,
            headline_ko: `Demo Roasted Bean의 정성`,
            subheadline_en: `Small-batch, no shortcuts. Bring a friend and share two ${matched.item}s — second one's on us.`,
            subheadline_es: `Lotes pequeños, sin atajos. Trae a un amigo y compartan dos ${matched.item}s — el segundo va por la casa.`,
            subheadline_ko: `소량 생산, 타협 없는 맛. 친구와 함께 ${matched.item} 두 잔을 — 두 번째는 무료.`,
            cta_en: "Visit us today",
            cta_es: "Visítanos hoy",
            cta_ko: "오늘 방문하세요",
            style_label: "Artisan warmth",
            rationale: "Combines craft messaging with neighborly warmth — inviting without being pushy.",
            visual_direction: "Warm café interior, barista at work, soft golden hour light.",
          },
          {
            variant_id: "C",
            headline_en: `Two for one — real ingredients, real craft`,
            headline_es: `Dos por uno — ingredientes reales, verdadera calidad`,
            headline_ko: `1+1 — 진짜 재료, 진짜 정성`,
            subheadline_en: `We don't cut corners on our ${matched.item}. Now there's twice the reason to stop by Demo Roasted Bean.`,
            subheadline_es: `No escatimamos en nuestro ${matched.item}. Ahora hay el doble de razones para pasar por Demo Roasted Bean.`,
            subheadline_ko: `저희 ${matched.item}에는 타협이 없습니다. Demo Roasted Bean에 들를 이유가 두 배가 되었습니다.`,
            cta_en: "Discover the difference",
            cta_es: "Descubre la diferencia",
            cta_ko: "차이를 느껴보세요",
            style_label: "Premium simplicity",
            rationale: "Clean, confident tone that trusts the product quality to do the selling.",
            visual_direction: "Clean layout, single product hero shot, restrained serif typography.",
          },
        ],
        input_type: demoHasImage && demoHasText ? "mixed" : demoHasImage ? "image_only" : "text_only",
      };

      return new Response(
        JSON.stringify({
          ok: true,
          duplicate_cached: false,
          result: demoResult,
          poster_storage_path: null,
          quota: { used: 0, limit: 30, remaining: 30 },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (transcribeOnly) {
      if (!openAiKey) {
        return new Response(
          JSON.stringify({ ok: true, transcript: promptTextRaw || "oat milk latte special — freshly pulled" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!audioBase64 || audioBase64.length > 700_000) {
        return new Response(
          JSON.stringify({ error: "Record a short voice note and try again.", error_code: "INVALID_INPUT" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const transcribeCooldownMs = 15_000;
      const { data: recentTx } = await admin
        .from("ai_generation_logs")
        .select("id")
        .eq("business_id", business_id)
        .eq("request_type", "voice_transcribe")
        .gte("created_at", new Date(Date.now() - transcribeCooldownMs).toISOString())
        .limit(1)
        .maybeSingle();
      if (recentTx) {
        return new Response(
          JSON.stringify({
            error: "Please wait a moment before transcribing again.",
            error_code: "COOLDOWN_ACTIVE",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      try {
        const tx = await transcribeAudio(openAiKey, audioBase64);
        const th = await sha256Hex(audioBase64.slice(0, 4000));
        await admin.from("ai_generation_logs").insert({
          business_id,
          user_id: user.id,
          request_type: "voice_transcribe",
          input_mode: "voice",
          prompt_text: tx || null,
          request_hash: th,
          prompt_version: PROMPT_VERSION,
          model: WHISPER_MODEL,
          success: true,
          openai_called: true,
        });
        return new Response(
          JSON.stringify({ ok: true, transcript: tx }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (e) {
        console.log(JSON.stringify({ tag: "ai_compose", event: "whisper_error", err: String(e) }));
        return new Response(
          JSON.stringify({
            error: e instanceof Error ? e.message : "Voice transcription failed.",
            error_code: "TRANSCRIPTION_FAILED",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    let promptText = promptTextRaw;
    const combinedText = normalizePrompt([promptText, voiceTranscriptIn]);
    const hasImage = imageBase64.length > 0;
    const hasText = combinedText.length > 0;

    if (!hasImage && !hasText) {
      return new Response(
        JSON.stringify({
          error: "Add a photo, type a request, or record a voice note.",
          error_code: "INVALID_INPUT",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (imageBase64.length > 1_200_000) {
      return new Response(
        JSON.stringify({ error: "Image is too large. Try a smaller photo.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const input_mode = hasImage && hasText ? "mixed" : hasImage ? "image_only" : "text_only";
    const request_hash = await sha256Hex(
      JSON.stringify({
        b: business_id,
        i: hasImage ? await sha256Hex(imageBase64.slice(0, 2000)) : "",
        t: combinedText.slice(0, 4000),
      }),
    );

    const now = Date.now();
    const cooldownMs = Math.max(10, DEFAULT_COOLDOWN_SEC) * 1000;
    const dedupMs = Math.max(60, DEFAULT_DEDUP_SEC) * 1000;
    const monthStart = utcMonthStartIso();

    const { data: dupRow } = await admin
      .from("ai_generation_logs")
      .select("id,response_payload")
      .eq("business_id", business_id)
      .eq("request_type", "compose_offer")
      .eq("request_hash", request_hash)
      .eq("success", true)
      .not("response_payload", "is", null)
      .gte("created_at", new Date(now - dedupMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dupRow?.response_payload) {
      const dupOf = dupRow.id;
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        voice_transcript: voiceTranscriptIn || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        model: MODEL,
        success: true,
        duplicate_blocked: true,
        duplicate_of_log_id: dupOf,
        openai_called: false,
        response_payload: dupRow.response_payload,
        low_confidence: !!(dupRow.response_payload as Record<string, unknown>)?.low_confidence,
      });

      const usedOpenAi = await admin
        .from("ai_generation_logs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business_id)
        .eq("request_type", "compose_offer")
        .eq("openai_called", true)
        .eq("success", true)
        .gte("created_at", monthStart);

      const limit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;
      const used = usedOpenAi.count ?? 0;

      return new Response(
        JSON.stringify({
          ok: true,
          duplicate_cached: true,
          result: dupRow.response_payload,
          quota: { used, limit, remaining: Math.max(0, limit - used) },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: recentCooldown } = await admin
      .from("ai_generation_logs")
      .select("id")
      .eq("business_id", business_id)
      .eq("request_type", "compose_offer")
      .eq("success", true)
      .gte("created_at", new Date(now - cooldownMs).toISOString())
      .limit(1)
      .maybeSingle();

    if (recentCooldown) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        success: false,
        failure_reason: "COOLDOWN_ACTIVE",
        openai_called: false,
      });
      return new Response(
        JSON.stringify({
          error: "Please wait a moment before generating again.",
          error_code: "COOLDOWN_ACTIVE",
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { count: monthlyCount } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business_id)
      .eq("request_type", "compose_offer")
      .eq("openai_called", true)
      .eq("success", true)
      .gte("created_at", monthStart);

    const limit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;
    const used = monthlyCount ?? 0;
    if (used >= limit) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        success: false,
        failure_reason: "QUOTA_EXCEEDED",
        quota_blocked: true,
        openai_called: false,
      });
      return new Response(
        JSON.stringify({
          error: "Monthly AI generation limit reached.",
          error_code: "QUOTA_EXCEEDED",
          quota: { used, limit, remaining: 0 },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!openAiKey) {
      // No API key: return quality template response for all users
      const rawInput2 = (promptTextRaw || voiceTranscriptIn || "").toLowerCase();
      const demoHasImage2 = imageBase64.length > 0;
      const demoHasText2 = (promptTextRaw + voiceTranscriptIn).trim().length > 0;

      type CI2 = { item: string; offerType: string; display: string };
      const itemMap2: [RegExp, CI2][] = [
        [/oat\s*milk\s*latte|latte/i, { item: "oat milk latte", offerType: "bogo_same_item", display: "Buy one oat milk latte, get one free" }],
        [/cortado|espresso/i, { item: "vanilla cortado", offerType: "bogo_same_item", display: "Buy one vanilla cortado, get one free" }],
        [/cold\s*brew|iced/i, { item: "single-origin cold brew", offerType: "bogo_same_item", display: "Buy one cold brew, get one free" }],
        [/matcha|green\s*tea/i, { item: "matcha latte", offerType: "bogo_same_item", display: "Buy one matcha latte, get one free" }],
        [/croissant/i, { item: "butter croissant", offerType: "bogo_same_item", display: "Buy one butter croissant, get one free" }],
        [/muffin|blueberry/i, { item: "blueberry muffin", offerType: "bogo_same_item", display: "Buy one blueberry muffin, get one free" }],
        [/pastry|baked/i, { item: "pastry", offerType: "bogo_same_item", display: "Buy one pastry, get one free" }],
        [/combo|pair|\+|and a|with a/i, { item: "latte + pastry", offerType: "free_add_on_with_purchase", display: "Free pastry with any latte purchase" }],
      ];
      let matched2: CI2 = { item: "oat milk latte", offerType: "bogo_same_item", display: "Buy one oat milk latte, get one free" };
      for (const [rx, ci] of itemMap2) { if (rx.test(rawInput2)) { matched2 = ci; break; } }

      const bizName = typeof body.business_name === "string" ? body.business_name : "your business";
      const fallbackResult = {
        detected_items: [matched2.item],
        confidence: 0.92,
        low_confidence: false,
        recommendation_reason: `A quality ${matched2.item} BOGO highlights your craft and brings new faces through the door.`,
        recommended_offer: { offer_type: matched2.offerType, item_name: matched2.item, display_offer: matched2.display },
        ad_variants: [
          {
            variant_id: "A",
            headline_en: `Handcrafted ${matched2.item}, doubled`, headline_es: `${matched2.item} artesanal, por partida doble`, headline_ko: `\uC815\uC131 \uB2F4\uC740 ${matched2.item} 1+1`,
            subheadline_en: `Every ${matched2.item} is made fresh with single-origin beans and real ingredients. Now enjoy two for the price of one.`,
            subheadline_es: `Cada ${matched2.item} se prepara con ingredientes reales. Dos por el precio de uno.`,
            subheadline_ko: `\uC2F1\uAE00 \uC624\uB9AC\uC9C4 \uC6D0\uB450\uC640 \uC2E0\uC120\uD55C \uC7AC\uB8CC\uB85C \uB9CC\uB4E0 ${matched2.item}. \uD558\uB098 \uAC00\uACA9\uC5D0 \uB458.`,
            cta_en: "Taste the craft", cta_es: "Prueba la calidad", cta_ko: "\uC7A5\uC778\uC758 \uB9DB \uACBD\uD5D8\uD558\uAE30",
            style_label: "Quality-led",
            rationale: "Leads with craftsmanship to position the deal as a premium experience.",
            visual_direction: "Tight crop on product texture, natural light, minimal text overlay.",
          },
          {
            variant_id: "B",
            headline_en: `Made with care at ${bizName}`, headline_es: `Hecho con cari\u00F1o en ${bizName}`, headline_ko: `${bizName}\uC758 \uC815\uC131`,
            subheadline_en: `Small-batch, no shortcuts. Bring a friend and share two ${matched2.item}s \u2014 second one's on us.`,
            subheadline_es: `Lotes peque\u00F1os, sin atajos. El segundo ${matched2.item} va por la casa.`,
            subheadline_ko: `\uC18C\uB7C9 \uC0DD\uC0B0, \uD0C0\uD611 \uC5C6\uB294 \uB9DB. \uB450 \uBC88\uC9F8 ${matched2.item}\uB294 \uBB34\uB8CC.`,
            cta_en: "Visit us today", cta_es: "Vis\u00EDtanos hoy", cta_ko: "\uC624\uB298 \uBC29\uBB38\uD558\uC138\uC694",
            style_label: "Artisan warmth",
            rationale: "Combines craft messaging with neighborly warmth.",
            visual_direction: "Warm caf\u00E9 interior, barista at work, soft golden hour light.",
          },
          {
            variant_id: "C",
            headline_en: `Two for one \u2014 real ingredients, real craft`, headline_es: `Dos por uno \u2014 ingredientes reales`, headline_ko: `1+1 \u2014 \uC9C4\uC9DC \uC7AC\uB8CC, \uC9C4\uC9DC \uC815\uC131`,
            subheadline_en: `We don't cut corners on our ${matched2.item}. Twice the reason to stop by.`,
            subheadline_es: `No escatimamos en nuestro ${matched2.item}. El doble de razones para visitarnos.`,
            subheadline_ko: `${matched2.item}\uC5D0\uB294 \uD0C0\uD611\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uBC29\uBB38\uD560 \uC774\uC720\uAC00 \uB450 \uBC30.`,
            cta_en: "Discover the difference", cta_es: "Descubre la diferencia", cta_ko: "\uCC28\uC774\uB97C \uB290\uAEF4\uBCF4\uC138\uC694",
            style_label: "Premium simplicity",
            rationale: "Clean, confident tone that trusts the product quality.",
            visual_direction: "Clean layout, single product hero shot, restrained serif typography.",
          },
        ],
        input_type: demoHasImage2 && demoHasText2 ? "mixed" : demoHasImage2 ? "image_only" : "text_only",
      };
      return new Response(
        JSON.stringify({ ok: true, duplicate_cached: false, result: fallbackResult, poster_storage_path: null, quota: { used: 0, limit: 30, remaining: 30 } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = [
      "You help local cafés and small businesses draft ONE promotional offer and TWO short ad variants for the same offer.",
      `Allowed offer_type values only: ${OFFER_TYPES.join(", ")}.`,
      "",
      "VOICE & TONE — this is advertising for independent, craft-focused businesses:",
      "- Write like the owner's best marketer — warm, confident, never corporate or salesy.",
      "- Lead with what makes the product special: ingredients, process, freshness, care.",
      "- Use sensory language: \"hand-pulled\", \"small-batch\", \"stone-ground\", \"freshly baked\", \"single-origin\".",
      "- The deal should feel like a generous invitation from a craftsperson, not a clearance sale.",
      "- Avoid generic ad-speak: no \"best deal ever\", \"amazing offer\", \"you won't believe\", \"act now\", \"don't miss out\".",
      "- Avoid exclamation marks. Confidence doesn't shout.",
      "- Variant A should lead with craft/quality. Variant B should lead with neighborly warmth.",
      "",
      "SHORTHAND INTERPRETATION — very important:",
      "- 'item1 + item2' (two items joined by +) always means: buy item1, get item2 FREE.",
      "  Example: 'coffee + muffin' → 'Buy a coffee, get a free muffin'.",
      "  Example: 'latte + cookie' → 'Buy a latte, get a free cookie'.",
      "  Use offer_type 'free_add_on_with_purchase' for these.",
      "- A single item with no offer context → recommend BOGO same item (bogo_same_item).",
      "",
      "MISSPELLING HANDLING — very important:",
      "- Owners type quickly and make typos. Infer the correct item from context.",
      "  Example: 'cofee' → coffee, 'mufin' → muffin, 'latt' → latte, 'espreso' → espresso.",
      "- If a word is unrecognisable, use your best guess and set low_confidence: true.",
      "",
      "DEAL QUALITY — every output MUST qualify as a strong deal:",
      "- Always output a deal that is either: (a) something FREE, (b) BOGO/2-for-1, or (c) 40%+ off.",
      "- NEVER output conditional discounts like 'buy X + N% off Y' — that fails our quality check.",
      "- If the input implies a partial discount, upgrade it to a free-item offer instead.",
      "",
      "Rules:",
      "- Never invent prices. If no price is given, omit price language or say price varies.",
      "- Never invent menu items not visible in the image or stated in text.",
      "- If the user clearly states the offer (e.g. BOGO latte), keep that offer; use image only as supporting context.",
      "- If input is vague, recommend one sensible offer from allowed types.",
      "- Output valid JSON only, no markdown.",
      "- ad_variants must contain exactly 2 objects; same underlying offer, different copy style (tone/framing).",
      "- Each variant: variant_id 'A' or 'B', headline_en/es/ko (<=42 chars), subheadline_* (<=80), cta_* (<=24), style_label, rationale, visual_direction.",
      "- Include detected_items array (strings).",
      "- confidence 0-1. low_confidence true if unsure; add recommendation_reason.",
      "- recommended_offer: offer_type, item_name, display_offer (short plain sentence describing the deal clearly).",
    ].join("\n");

    const userParts: unknown[] = [];
    userParts.push({
      type: "text",
      text: [
        `Business: ${biz.name}. Category: ${biz.category ?? "n/a"}. Location: ${biz.location}.`,
        biz.short_description ? `About: ${biz.short_description}` : "",
        combinedText ? `Owner request:\n${combinedText}` : "No text request; infer from image only.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (hasImage) {
      const mime = imageBase64.startsWith("data:") ? imageBase64.split(";")[0].replace("data:", "") : "image/jpeg";
      const b64 = imageBase64.includes(",") ? imageBase64.split(",")[1]! : imageBase64;
      userParts.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${b64}` },
      });
    }

    const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userParts },
        ],
        max_tokens: 1200,
        temperature: 0.7,
      }),
    });

    if (!openAiRes.ok) {
      const errText = await openAiRes.text();
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        model: MODEL,
        success: false,
        failure_reason: `OPENAI_${openAiRes.status}`,
        openai_called: true,
      });
      return new Response(
        JSON.stringify({
          error: "AI service error. Try again shortly.",
          error_code: "OPENAI_ERROR",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const completion = await openAiRes.json();
    const content = completion?.choices?.[0]?.message?.content;
    const usage = completion?.usage ?? {};
    const inTok = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null;
    const outTok = typeof usage.completion_tokens === "number" ? usage.completion_tokens : null;
    const estCost =
      inTok != null && outTok != null
        ? Number(((inTok * 0.15 + outTok * 0.6) / 1_000_000).toFixed(6))
        : null;

    let parsed: Record<string, unknown>;
    try {
      parsed = typeof content === "string" ? JSON.parse(content) : {};
    } catch {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        model: MODEL,
        success: false,
        failure_reason: "PARSE_ERROR",
        openai_called: true,
        input_token_count: inTok,
        output_token_count: outTok,
        estimated_cost_usd: estCost,
      });
      return new Response(
        JSON.stringify({
          error: "Could not parse AI response. Try again.",
          error_code: "PARSE_ERROR",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const variants = parsed.ad_variants;
    const offer = parsed.recommended_offer as Record<string, unknown> | undefined;
    if (!Array.isArray(variants) || variants.length !== 2 || !offer?.offer_type) {
      await admin.from("ai_generation_logs").insert({
        business_id,
        user_id: user.id,
        request_type: "compose_offer",
        input_mode,
        prompt_text: combinedText || null,
        request_hash,
        prompt_version: PROMPT_VERSION,
        model: MODEL,
        success: false,
        failure_reason: "INVALID_AI_SHAPE",
        openai_called: true,
        input_token_count: inTok,
        output_token_count: outTok,
        estimated_cost_usd: estCost,
        response_payload: parsed,
      });
      return new Response(
        JSON.stringify({
          error: "AI returned an unexpected format. Try again.",
          error_code: "PARSE_ERROR",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const low = !!parsed.low_confidence;
    const offerType = String(offer.offer_type);
    const logPayload = { ...parsed, input_type: input_mode } as Record<string, unknown>;

    let poster_storage_path: string | null = null;
    let poster_image_unavailable = false;
    if (generate_poster_image && !hasImage && hasText) {
      const v0 = variants[0] as Record<string, unknown>;
      const headline = String(v0.headline_en ?? "");
      const sub = String(v0.subheadline_en ?? "");
      const displayOffer = String(offer.display_offer ?? "");
      const visualDirection = String(v0.visual_direction ?? "");
      const imgPrompt = buildPosterImagePrompt({
        businessName: String(biz.name ?? ""),
        displayOffer,
        headline: headline || displayOffer,
        sub,
        visualDirection,
      });
      const png = await tryGeneratePosterPng(openAiKey, imgPrompt);
      if (png && png.length > 100) {
        const storagePath = `${business_id}/ai_poster_${Date.now()}.png`;
        const { error: upErr } = await admin.storage.from("deal-photos").upload(storagePath, png, {
          contentType: "image/png",
          upsert: false,
        });
        if (!upErr) {
          poster_storage_path = storagePath;
          logPayload.poster_storage_path = storagePath;
        } else {
          poster_image_unavailable = true;
          console.log(
            JSON.stringify({
              tag: "ai_compose",
              event: "poster_upload_failed",
              err: String(upErr.message ?? upErr),
            }),
          );
        }
      } else {
        poster_image_unavailable = true;
      }
      logPayload.poster_image_unavailable = poster_image_unavailable;
    }

    await admin.from("ai_generation_logs").insert({
      business_id,
      user_id: user.id,
      request_type: "compose_offer",
      input_mode,
      prompt_text: combinedText || null,
      voice_transcript: voiceTranscriptIn || null,
      request_hash,
      prompt_version: PROMPT_VERSION,
      model: MODEL,
      success: true,
      openai_called: true,
      low_confidence: low,
      recommended_offer_type: offerType,
      input_token_count: inTok,
      output_token_count: outTok,
      estimated_cost_usd: estCost,
      response_payload: logPayload,
    });

    const newUsed = used + 1;
    return new Response(
      JSON.stringify({
        ok: true,
        duplicate_cached: false,
        result: logPayload,
        poster_storage_path,
        quota: { used: newUsed, limit, remaining: Math.max(0, limit - newUsed) },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ tag: "ai_compose", event: "unhandled_error", err: msg }));
    return new Response(
      JSON.stringify({ error: msg || "Unexpected error", error_code: "INTERNAL" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
