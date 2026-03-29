import { supabase } from "./supabase";
import { EDGE_FUNCTION_TIMEOUT_AI_MS, parseFunctionError } from "./functions";

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

export async function aiComposeOfferGenerate(body: {
  business_id: string;
  prompt_text?: string;
  image_base64?: string;
  /** When true and request is text-only, edge function generates a poster via OpenAI Images and uploads it. */
  generate_poster_image?: boolean;
}): Promise<AiComposeSuccess> {
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
