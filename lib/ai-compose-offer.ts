import { supabase } from "./supabase";
import { EDGE_FUNCTION_TIMEOUT_AI_MS, parseFunctionError } from "./functions";
import { isDemoPreviewAccountEmail } from "@/lib/demo-account";
import { devWarn } from "@/lib/dev-log";

export type AiComposeQuota = {
  used: number;
  limit: number;
  remaining: number;
};

export type RecommendedOffer = {
  offer_type: string;
  item_name: string;
  display_offer: string;
};

export type AiAdVariant = {
  variant_id: string;
  headline_en: string;
  subheadline_en: string;
  cta_en: string;
  headline_es: string;
  subheadline_es: string;
  cta_es: string;
  headline_ko: string;
  subheadline_ko: string;
  cta_ko: string;
  style_label: string;
  rationale: string;
  visual_direction: string;
};

export type AiComposeResultPayload = {
  input_type?: string;
  detected_items?: string[];
  confidence?: number;
  low_confidence?: boolean;
  recommendation_reason?: string;
  recommended_offer: RecommendedOffer;
  ad_variants: AiAdVariant[];
  /** Set when text-only compose requested an AI poster image (stored under deal-photos). */
  poster_storage_path?: string | null;
  /** True when a poster was requested (text-only) but image generation or upload failed. */
  poster_image_unavailable?: boolean;
};

export type AiComposeSuccess = {
  ok: true;
  duplicate_cached?: boolean;
  result: AiComposeResultPayload;
  quota: AiComposeQuota;
};

export type AiComposeErrorBody = {
  error: string;
  error_code?: string;
  quota?: AiComposeQuota;
};

function attachComposeErrorMeta(err: Error, rawBody: unknown) {
  if (!rawBody || typeof rawBody !== "object") return;
  const o = rawBody as Record<string, unknown>;
  if (typeof o.error_code === "string") (err as Error & { code?: string }).code = o.error_code;
  if (o.quota && typeof o.quota === "object") {
    const q = o.quota as Record<string, unknown>;
    (err as Error & { quota?: AiComposeQuota }).quota = {
      used: Number(q.used) || 0,
      limit: Number(q.limit) || 30,
      remaining: Number(q.remaining) || 0,
    };
  }
}

export async function aiComposeOfferTranscribe(body: {
  business_id: string;
  audio_base64: string;
}): Promise<{ transcript: string }> {
  const { data, error } = await supabase.functions.invoke("ai-compose-offer", {
    body: {
      business_id: body.business_id,
      audio_base64: body.audio_base64,
      transcribe_only: true,
    },
    timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
  });
  if (error) {
    const e = new Error(parseFunctionError(error)) as Error & { code?: string };
    const ctx = (error as { context?: { body?: unknown } }).context;
    attachComposeErrorMeta(e, ctx?.body);
    throw e;
  }
  const d = data as { ok?: boolean; transcript?: string; error?: string };
  if (d?.error) throw new Error(d.error);
  if (typeof d?.transcript !== "string") throw new Error("Unexpected transcription response.");
  return { transcript: d.transcript };
}

/** Client-side demo fallback for compose offer (quality/craft tone). */
function buildDemoComposeResult(prompt?: string): AiComposeSuccess {
  const raw = (prompt ?? "").toLowerCase();

  // Detect item from prompt
  type CI = { item: string; display: string };
  const patterns: [RegExp, CI][] = [
    [/oat\s*milk\s*latte|latte/, { item: "oat milk latte", display: "Buy one oat milk latte, get one free" }],
    [/cortado|espresso/, { item: "vanilla cortado", display: "Buy one vanilla cortado, get one free" }],
    [/cold\s*brew|iced/, { item: "single-origin cold brew", display: "Buy one cold brew, get one free" }],
    [/matcha|green\s*tea/, { item: "matcha latte", display: "Buy one matcha latte, get one free" }],
    [/croissant/, { item: "butter croissant", display: "Buy one butter croissant, get one free" }],
    [/muffin|blueberry/, { item: "blueberry muffin", display: "Buy one blueberry muffin, get one free" }],
    [/pastry|baked/, { item: "pastry", display: "Buy one pastry, get one free" }],
  ];
  let m: CI = { item: "oat milk latte", display: "Buy one oat milk latte, get one free" };
  for (const [rx, ci] of patterns) { if (rx.test(raw)) { m = ci; break; } }

  return {
    ok: true,
    result: {
      input_type: "text",
      detected_items: [m.item],
      confidence: 0.92,
      recommendation_reason: `A quality ${m.item} BOGO highlights your craft and brings new faces through the door.`,
      recommended_offer: {
        offer_type: "bogo_same_item",
        item_name: m.item,
        display_offer: m.display,
      },
      ad_variants: [
        {
          variant_id: "demo-v1",
          headline_en: `Handcrafted ${m.item}, doubled`,
          headline_es: `${m.item} artesanal, por partida doble`,
          headline_ko: `정성 담은 ${m.item} 1+1`,
          subheadline_en: `Every ${m.item} is made fresh with single-origin beans and real ingredients. Two for the price of one.`,
          subheadline_es: `Cada ${m.item} se prepara con ingredientes reales. Dos por el precio de uno.`,
          subheadline_ko: `신선한 재료로 만든 ${m.item}. 하나 가격에 둘.`,
          cta_en: "Taste the craft", cta_es: "Prueba la calidad", cta_ko: "장인의 맛 경험하기",
          style_label: "Quality-led",
          rationale: "Leads with craftsmanship to position the deal as a premium experience.",
          visual_direction: "Tight crop on product texture, natural light, minimal text overlay.",
        },
        {
          variant_id: "demo-v2",
          headline_en: `Made with care at Demo Roasted Bean`,
          headline_es: `Hecho con cariño en Demo Roasted Bean`,
          headline_ko: `Demo Roasted Bean의 정성`,
          subheadline_en: `Small-batch, no shortcuts. Bring a friend and share two ${m.item}s — second one's on us.`,
          subheadline_es: `Lotes pequeños, sin atajos. El segundo ${m.item} va por la casa.`,
          subheadline_ko: `소량 생산, 타협 없는 맛. 두 번째 ${m.item}는 무료.`,
          cta_en: "Visit us today", cta_es: "Visítanos hoy", cta_ko: "오늘 방문하세요",
          style_label: "Artisan warmth",
          rationale: "Combines craft messaging with neighborly warmth.",
          visual_direction: "Warm café interior, barista at work, soft golden hour light.",
        },
        {
          variant_id: "demo-v3",
          headline_en: `Two for one — real ingredients, real craft`,
          headline_es: `Dos por uno — ingredientes reales, verdadera calidad`,
          headline_ko: `1+1 — 진짜 재료, 진짜 정성`,
          subheadline_en: `We don't cut corners on our ${m.item}. Twice the reason to stop by.`,
          subheadline_es: `No escatimamos en nuestro ${m.item}. El doble de razones para visitarnos.`,
          subheadline_ko: `${m.item}에는 타협이 없습니다. 방문할 이유가 두 배.`,
          cta_en: "Discover the difference", cta_es: "Descubre la diferencia", cta_ko: "차이를 느껴보세요",
          style_label: "Premium simplicity",
          rationale: "Clean, confident tone that trusts the product quality to sell.",
          visual_direction: "Clean layout, single product hero shot, restrained serif typography.",
        },
      ],
    },
    quota: { used: 0, limit: 30, remaining: 30 },
  };
}

export async function aiComposeOfferGenerate(body: {
  business_id: string;
  prompt_text?: string;
  image_base64?: string;
  /** When true and request is text-only, edge function generates a poster via OpenAI Images and uploads it. */
  generate_poster_image?: boolean;
}): Promise<AiComposeSuccess> {
  try {
    const { data, error } = await supabase.functions.invoke("ai-compose-offer", {
      body: {
        business_id: body.business_id,
        prompt_text: body.prompt_text?.trim() || undefined,
        image_base64: body.image_base64,
        generate_poster_image: body.generate_poster_image === true,
      },
      timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
    });

    if (error) {
      const e = new Error(parseFunctionError(error)) as Error & { code?: string; quota?: AiComposeQuota };
      const ctx = (error as { context?: { body?: unknown } }).context;
      attachComposeErrorMeta(e, ctx?.body);
      try {
        const parsed = JSON.parse(String((error as { message?: string }).message ?? ""));
        attachComposeErrorMeta(e, parsed);
      } catch {
        /* ignore */
      }
      throw e;
    }

    const d = data as AiComposeSuccess & AiComposeErrorBody;
    if (d && typeof d === "object" && "error" in d && d.error) {
      const err = new Error(d.error) as Error & { code?: string; quota?: AiComposeQuota };
      err.code = d.error_code;
      err.quota = d.quota;
      throw err;
    }
    if (!d?.ok || !d.result?.recommended_offer || !Array.isArray(d.result.ad_variants)) {
      throw new Error("Unexpected AI compose response.");
    }
    return d as AiComposeSuccess;
  } catch (err) {
    // Demo accounts: return client-side template instead of failing
    const { data } = await supabase.auth.getUser();
    if (isDemoPreviewAccountEmail(data?.user?.email)) {
      devWarn("[aiComposeOfferGenerate] Edge function failed for demo user, using client fallback:", err);
      return buildDemoComposeResult(body.prompt_text);
    }
    throw err;
  }
}

export async function fetchAiComposeQuota(businessId: string): Promise<AiComposeQuota | null> {
  const { data, error } = await supabase.rpc("ai_compose_quota_status", {
    p_business_id: businessId,
  });
  if (error || !data || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { used_count: number; monthly_limit: number };
  const limit = row.monthly_limit ?? 30;
  const used = row.used_count ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used) };
}

export function pickVariantCopyForLocale(v: AiAdVariant, lang: string): { headline: string; sub: string; cta: string } {
  const l = lang.split("-")[0]?.toLowerCase() ?? "en";
  if (l === "es") {
    return { headline: v.headline_es || v.headline_en, sub: v.subheadline_es || v.subheadline_en, cta: v.cta_es || v.cta_en };
  }
  if (l === "ko") {
    return { headline: v.headline_ko || v.headline_en, sub: v.subheadline_ko || v.subheadline_en, cta: v.cta_ko || v.cta_en };
  }
  return { headline: v.headline_en, sub: v.subheadline_en, cta: v.cta_en };
}
