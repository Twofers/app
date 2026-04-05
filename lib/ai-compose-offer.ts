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

/** Client-side demo fallback for compose offer. */
function buildDemoComposeResult(prompt?: string): AiComposeSuccess {
  const hint = prompt?.slice(0, 40) ?? "deal";
  return {
    ok: true,
    result: {
      input_type: "text",
      detected_items: [hint],
      confidence: 0.95,
      recommendation_reason: "Demo mode — template response",
      recommended_offer: {
        offer_type: "BOGO",
        item_name: hint,
        display_offer: `Buy one ${hint}, get one free`,
      },
      ad_variants: [
        {
          variant_id: "demo-v1",
          headline_en: `BOGO ${hint}`, subheadline_en: "Buy one, get one free", cta_en: "Grab Yours",
          headline_es: `BOGO ${hint}`, subheadline_es: "Compra uno, lleva otro gratis", cta_es: "Aprovecha",
          headline_ko: `BOGO ${hint}`, subheadline_ko: "하나 사면 하나 무료", cta_ko: "지금 바로",
          style_label: "Value", rationale: "Clear savings", visual_direction: "Bold",
        },
        {
          variant_id: "demo-v2",
          headline_en: `Neighbors Love This ${hint}`, subheadline_en: "Bring a friend", cta_en: "Visit Us",
          headline_es: `Los vecinos aman ${hint}`, subheadline_es: "Trae a un amigo", cta_es: "Visítanos",
          headline_ko: `이웃이 사랑하는 ${hint}`, subheadline_ko: "친구와 함께", cta_ko: "방문하기",
          style_label: "Community", rationale: "Local feel", visual_direction: "Warm",
        },
        {
          variant_id: "demo-v3",
          headline_en: `Crafted ${hint}`, subheadline_en: "Two for one, made with care", cta_en: "Discover",
          headline_es: `${hint} artesanal`, subheadline_es: "Dos por uno, hecho con cariño", cta_es: "Descubrir",
          headline_ko: `정성 가득 ${hint}`, subheadline_ko: "투포원 특별 혜택", cta_ko: "알아보기",
          style_label: "Premium", rationale: "Quality focus", visual_direction: "Clean",
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
