/**
 * ai-generate-ad-variants — TWOFER ad generator (single-ad pipeline).
 *
 * Quality-first rewrite (2026-05-01):
 * - Stage 1: optional web research for unfamiliar menu items (gpt-4o-search-preview).
 * - Stage 2: copy generation tuned for an item-forward, anti-AI-tell voice.
 * - Stage 3: image — enhance the cafe's uploaded photo (touchup / cleanbg / studiopolish)
 *            OR generate a photoreal hero via the configured GPT image model when no photo is provided.
 *
 * The app renders the headline/subline/CTA ABOVE the image — text is never baked in.
 *
 * Returns a single ad. For backward compatibility with old clients, the response also
 * includes `ads: [ad]` so existing UI that expects an array does not crash.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient as SupabaseClientBase } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel, chatCompletionTuning } from "../_shared/openai-chat-model.ts";
import { DEFAULT_MONTHLY_LIMIT, DEFAULT_COOLDOWN_SEC } from "../_shared/ai-limits.ts";
import {
  buildPhotoAdImagePrompt,
  enhanceUploadedPhoto,
  generatePhotoAdImage,
  type PhotoTreatment,
} from "../_shared/dalle-image.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import {
  AD_COPY_PROMPT_VERSION,
  buildAdCopyPrompt,
  type BusinessContext,
  type ItemResearch,
  type OutputLanguage,
} from "./prompt.ts";

const CHAT_MODEL = resolveOpenAiChatModel();
const RESEARCH_MODEL = "gpt-4o-search-preview";
const DEFAULT_MONTHLY = DEFAULT_MONTHLY_LIMIT;
const COOLDOWN_SEC = DEFAULT_COOLDOWN_SEC;

/** Hard cap to bound abuse. The client enforces a matching soft cap (2) for UX. */
const MAX_REVISION_COUNT = 2;

const VALID_PHOTO_TREATMENTS: ReadonlySet<PhotoTreatment> = new Set([
  "touchup",
  "cleanbg",
  "studiopolish",
]);
const VALID_REVISION_TARGETS = new Set(["copy", "image", "both"] as const);

type RevisionTarget = "copy" | "image" | "both";

type SingleAd = {
  /** Short, item-forward (≤40 chars). */
  headline: string;
  /** One sentence — explains what the item is OR why it's worth the trip (≤88 chars). */
  subheadline: string;
  short_description: string;
  push_notification: string;
  terms_summary: string;
  /** Verb-first action (≤26 chars). */
  cta: string;
  /** Research the AI used to write the copy. Empty when it skipped/failed research. */
  item_research: ItemResearch;
  /** How the image was produced. */
  photo_source: "uploaded_original" | "uploaded_enhanced" | "generated";
  /** Which enhancement was applied (only meaningful when photo_source = "uploaded_enhanced"). */
  photo_treatment: PhotoTreatment | null;
  /** Storage path in deal-photos bucket; null if image production failed. */
  poster_storage_path: string | null;
};

function utcMonthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd();
}

// ─── Stage 1: research ─────────────────────────────────────────────────────

/**
 * Research the menu item with web search. Returns description if useful, blank if unfamiliar.
 * Failures are silent — the copy stage works fine without research context.
 */
async function researchMenuItem(params: {
  openAiKey: string;
  itemHint: string;
  businessName: string;
  businessLocation: string;
}): Promise<ItemResearch> {
  const { openAiKey, itemHint, businessName, businessLocation } = params;
  const cleanHint = itemHint.trim().slice(0, 400);
  if (!cleanHint) {
    return { item_name: "", description: "", is_familiar: false };
  }

  const prompt = [
    "A cafe owner wrote the following note about a menu item they want to promote:",
    `"${cleanHint}"`,
    businessName ? `Business: ${businessName}.` : "",
    businessLocation ? `Location: ${businessLocation}.` : "",
    "",
    "Identify the menu item. If you know what it is, describe in 1-2 short sentences:",
    "  - What it is (kind of drink/pastry/dish)",
    "  - What makes it distinctive (flavor, origin, preparation)",
    "If the item is unfamiliar or the note is too vague, use web search to look it up.",
    "Be honest — if you genuinely cannot identify it after searching, set is_familiar to false.",
    "",
    'Respond in JSON only: {"item_name": "<short name>", "description": "<1-2 sentences>", "is_familiar": <bool>}',
  ]
    .filter(Boolean)
    .join("\n");

  // Stage 1a: try the web-search model (best — looks up unfamiliar items live)
  const webSearchResult = await callResearchModel({
    openAiKey,
    model: RESEARCH_MODEL,
    prompt,
    cleanHint,
    isWebSearch: true,
  });
  if (webSearchResult) return webSearchResult;

  // Stage 1b: fall back to the standard chat model — no live search, but uses training knowledge
  // for the 90%+ of items that are well-known cafe staples.
  const fallbackResult = await callResearchModel({
    openAiKey,
    model: CHAT_MODEL,
    prompt,
    cleanHint,
    isWebSearch: false,
  });
  if (fallbackResult) return fallbackResult;

  // Both failed — return the hint as item_name with no description
  return { item_name: cleanHint.slice(0, 60), description: "", is_familiar: false };
}

async function callResearchModel(params: {
  openAiKey: string;
  model: string;
  prompt: string;
  cleanHint: string;
  isWebSearch: boolean;
}): Promise<ItemResearch | null> {
  const { openAiKey, model, prompt, cleanHint, isWebSearch } = params;
  try {
    // gpt-4o-search-preview rejects temperature; standard chat models accept it.
    // chatCompletionTuning also maps the token/temperature params correctly for the
    // gpt-5 family (max_completion_tokens, no temperature) when CHAT_MODEL is the fallback.
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
      ...chatCompletionTuning(model, {
        maxTokens: 220,
        temperature: isWebSearch ? undefined : 0.4,
      }),
    };
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Bound the (web-search) research call so a slow model can't, together with
      // copy + image, push total server time past the app's 120s invoke budget.
      // On timeout the catch below returns null → graceful fallback, never a hard error.
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "research_http",
          model,
          isWebSearch,
          status: res.status,
        }),
      );
      return null;
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    const text = typeof content === "string" ? content.trim() : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ItemResearch>;
    return {
      item_name: clip(typeof parsed.item_name === "string" ? parsed.item_name : cleanHint, 80),
      description: clip(typeof parsed.description === "string" ? parsed.description : "", 280),
      is_familiar: parsed.is_familiar === true,
    };
  } catch (e) {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "research_error",
        model,
        isWebSearch,
        err: String(e).slice(0, 200),
      }),
    );
    return null;
  }
}

// ─── Stage 2: copy ─────────────────────────────────────────────────────────

async function generateCopy(params: {
  openAiKey: string;
  itemHint: string;
  research: ItemResearch;
  businessName: string;
  businessContext: BusinessContext;
  offerScheduleSummary: string;
  quantityLimit: number | null;
  redemptionLimit: string;
  outputLanguage: OutputLanguage;
  revisionPreset?: string;
  revisionFeedback?: string;
  previousAd?: SingleAd;
}): Promise<Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "cta">> {
  const {
    openAiKey,
    itemHint,
    research,
    businessName,
    businessContext,
    offerScheduleSummary,
    quantityLimit,
    redemptionLimit,
    outputLanguage,
    revisionPreset,
    revisionFeedback,
    previousAd,
  } = params;

  const { system, userText, jsonSchema } = buildAdCopyPrompt({
    itemHint,
    research,
    businessName,
    businessContext,
    offerScheduleSummary,
    quantityLimit,
    redemptionLimit,
    outputLanguage,
    revisionPreset,
    revisionFeedback,
    previousAd,
  });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      response_format: { type: "json_schema", json_schema: jsonSchema },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      ...chatCompletionTuning(CHAT_MODEL, {
        maxTokens: 400,
        temperature: isRevision ? 0.7 : 0.6,
      }),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OPENAI_COPY_${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(typeof content === "string" ? content : "{}") as {
    headline?: string;
    short_description?: string;
    push_notification?: string;
    terms_summary?: string;
  };
  const shortDescription = clip(parsed.short_description ?? "", 220);

  return {
    headline: clip(parsed.headline ?? "", 70),
    subheadline: shortDescription,
    short_description: shortDescription,
    push_notification: clip(parsed.push_notification ?? "", 90),
    terms_summary: clip(parsed.terms_summary ?? "", 240),
    cta: defaultCta(outputLanguage),
  };
}

function defaultCta(lang: OutputLanguage): string {
  if (lang === "es") return "Reclamar oferta";
  if (lang === "ko") return "딜 받기";
  return "Claim deal";
}

// ─── Stage 3: image ────────────────────────────────────────────────────────

type SupabaseClient = SupabaseClientBase<any, "public", "public", any, any>;

async function produceImage(params: {
  openAiKey: string;
  admin: SupabaseClient;
  userClient: SupabaseClient;
  businessId: string;
  photoPath: string | null;
  photoTreatment: PhotoTreatment | null;
  research: ItemResearch;
  itemHint: string;
  businessName: string;
}): Promise<{
  posterStoragePath: string | null;
  source: SingleAd["photo_source"];
  treatment: PhotoTreatment | null;
}> {
  const {
    openAiKey,
    admin,
    userClient,
    businessId,
    photoPath,
    photoTreatment,
    research,
    itemHint,
    businessName,
  } = params;

  const ts = Date.now();
  const rand = crypto.randomUUID().slice(0, 8);

  // Path A — owner uploaded a photo
  if (photoPath) {
    if (!photoTreatment) {
      // No enhancement: copy the uploaded photo to a stable poster path
      // (the original is already in deal-photos; we just point the ad at it)
      return {
        posterStoragePath: photoPath,
        source: "uploaded_original",
        treatment: null,
      };
    }

    const { data: signed, error: signedErr } = await userClient.storage
      .from("deal-photos")
      .createSignedUrl(photoPath, 60 * 60);
    if (signedErr || !signed?.signedUrl) {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "photo_signed_url_failed",
          err: signedErr?.message?.slice(0, 200),
        }),
      );
      return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null };
    }

    let imageBytes: Uint8Array;
    let imageMime = "image/png";
    try {
      const fetched = await fetch(signed.signedUrl);
      if (!fetched.ok) {
        return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null };
      }
      imageMime = fetched.headers.get("content-type") || "image/png";
      imageBytes = new Uint8Array(await fetched.arrayBuffer());
    } catch {
      return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null };
    }

    const enhanced = await enhanceUploadedPhoto({
      openAiKey,
      imageBytes,
      imageMime,
      treatment: photoTreatment,
    });

    if (!enhanced) {
      // Enhancement failed — fall back to the original photo so the user still gets an ad
      return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null };
    }

    const enhancedPath = `${businessId}/ai_ad_enhanced_${photoTreatment}_${ts}_${rand}.png`;
    const { error: upErr } = await admin.storage
      .from("deal-photos")
      .upload(enhancedPath, enhanced, { contentType: "image/png", upsert: false });
    if (upErr) {
      console.log(
        JSON.stringify({
          tag: "ai_ads_v2",
          event: "enhanced_upload_err",
          err: upErr.message?.slice(0, 200),
        }),
      );
      return { posterStoragePath: photoPath, source: "uploaded_original", treatment: null };
    }
    return { posterStoragePath: enhancedPath, source: "uploaded_enhanced", treatment: photoTreatment };
  }

  // Path B — no photo: generate via OpenAI Images (GPT image model)
  const itemName = research.item_name || itemHint || "menu item";
  const prompt = buildPhotoAdImagePrompt({
    itemName,
    itemDescription: research.is_familiar ? research.description : "",
    businessName,
  });
  const png = await generatePhotoAdImage(openAiKey, prompt);
  if (!png) {
    return { posterStoragePath: null, source: "generated", treatment: null };
  }
  const generatedPath = `${businessId}/ai_ad_generated_${ts}_${rand}.png`;
  const { error: upErr } = await admin.storage
    .from("deal-photos")
    .upload(generatedPath, png, { contentType: "image/png", upsert: false });
  if (upErr) {
    console.log(
      JSON.stringify({
        tag: "ai_ads_v2",
        event: "generated_upload_err",
        err: upErr.message?.slice(0, 200),
      }),
    );
    return { posterStoragePath: null, source: "generated", treatment: null };
  }
  return { posterStoragePath: generatedPath, source: "generated", treatment: null };
}

// ─── Strong-deal phrase guarantee ──────────────────────────────────────────
// Mirror of lib/strong-deal-guard.ts. The publish guard (client + server)
// rejects copy that lacks an explicit strong-deal phrase. The model is told to
// include one, but we also guarantee it deterministically so a generated ad can
// never be blocked at publish. Every token below is accepted by both guards.
const STRONG_PHRASE_RE =
  /\bbogo\b|\b2\s*[- ]?\s*for\s*[- ]?\s*1\b|\btwo\s*for\s*one\b|\bbuy\s*one\s*get\s*one\b|\bget\s+one\s+free\b|(?:^|\s)free\b|\bon\s+the\s+house\b|\bcomplimentary\b|\b(?:4\d|[5-9]\d|100)\s*%\s*off\b|\bgratis\b|\b2\s*(?:x|por)\s*1\b|무료|반값|1\s*\+\s*1/i;

function offerFallbackSubline(lang: "en" | "es" | "ko", item: string): string {
  const it = item.trim().slice(0, 30);
  if (lang === "es") {
    return clip(it ? `Compra uno y llévate otro ${it} gratis.` : "Compra uno y llévate otro gratis.", 88);
  }
  if (lang === "ko") {
    return clip(it ? `${it} 하나 사면 하나 무료.` : "하나 사면 하나 무료.", 88);
  }
  return clip(it ? `Buy one ${it}, get one free.` : "Buy one, get one free.", 88);
}

/** Guarantee the copy carries a publishable offer phrase; rewrite the subline if not. */
function ensureOfferPhrase(
  copy: Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "cta">,
  lang: OutputLanguage,
  item: string,
): Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "cta"> {
  if (STRONG_PHRASE_RE.test(`${copy.headline} ${copy.subheadline} ${copy.terms_summary} ${copy.cta}`)) {
    return copy;
  }
  const fallback = offerFallbackSubline(lang, item);
  return { ...copy, subheadline: fallback, short_description: fallback };
}

// ─── HTTP handler ──────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

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

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
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

    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : "";
    if (!businessId) {
      return new Response(JSON.stringify({ error: "Missing business_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const photoPath = typeof body.photo_path === "string" ? body.photo_path.trim() : "";
    const hintText = typeof body.hint_text === "string" ? body.hint_text.trim() : "";

    const photoTreatmentRaw = typeof body.photo_treatment === "string"
      ? body.photo_treatment.trim().toLowerCase()
      : "";
    const photoTreatment: PhotoTreatment | null =
      VALID_PHOTO_TREATMENTS.has(photoTreatmentRaw as PhotoTreatment)
        ? (photoTreatmentRaw as PhotoTreatment)
        : null;

    const businessContext: BusinessContext =
      body.business_context && typeof body.business_context === "object" && !Array.isArray(body.business_context)
        ? (body.business_context as BusinessContext)
        : {};

    const offerScheduleSummary = typeof body.offer_schedule_summary === "string"
      ? body.offer_schedule_summary.trim().slice(0, 500)
      : "";

    const rawQuantityLimit = typeof body.quantity_limit === "number"
      ? body.quantity_limit
      : typeof body.quantity_limit === "string"
      ? Number(body.quantity_limit)
      : NaN;
    const quantityLimit = Number.isFinite(rawQuantityLimit) && rawQuantityLimit > 0
      ? Math.floor(rawQuantityLimit)
      : null;

    const redemptionLimit = typeof body.redemption_limit === "string"
      ? body.redemption_limit.trim().slice(0, 300)
      : "";

    const rawOutLang = typeof body.output_language === "string"
      ? body.output_language.trim().toLowerCase()
      : "en";
    const outputLanguage: OutputLanguage =
      rawOutLang === "es" || rawOutLang === "ko" ? rawOutLang : "en";

    const previousAdRaw = body.previous_ad;
    const revisionTargetRaw = typeof body.revision_target === "string"
      ? body.revision_target.trim().toLowerCase()
      : "";
    const revisionTarget: RevisionTarget | null =
      VALID_REVISION_TARGETS.has(revisionTargetRaw as RevisionTarget)
        ? (revisionTargetRaw as RevisionTarget)
        : null;
    const revisionPreset = typeof body.revision_preset === "string"
      ? body.revision_preset.trim().slice(0, 200)
      : "";
    const revisionFeedback = typeof body.revision_feedback === "string"
      ? body.revision_feedback.trim().slice(0, 800)
      : "";

    /** Strict object-not-array narrowing — protects coerceSingleAd from `previous_ad: []` exploits. */
    const previousAdIsObject =
      !!previousAdRaw && typeof previousAdRaw === "object" && !Array.isArray(previousAdRaw);
    const isRevision: boolean = revisionTarget !== null && previousAdIsObject;

    if (!isRevision && !photoPath && !hintText) {
      return new Response(
        JSON.stringify({ error: "Provide at least a photo or a description of the offer." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Ownership check — must run before any expensive work
    const { data: business, error: bizErr } = await userClient
      .from("businesses")
      .select("id, owner_id, name")
      .eq("id", businessId)
      .single();
    if (bizErr || !business || business.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "You do not own this business." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const businessName = typeof business.name === "string" ? business.name : "";

    /**
     * Path-traversal guard: clients must only operate on photos under their own business folder.
     * Without this, a malicious client could pass `other-business-id/some.png` and either generate
     * an ad against another tenant's product photo, or have it republished as their own poster.
     */
    if (photoPath && !photoPath.startsWith(`${businessId}/`)) {
      return new Response(
        JSON.stringify({ error: "Invalid photo path." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Quota: monthly limit
    const monthlyLimit = Number.isFinite(DEFAULT_MONTHLY) && DEFAULT_MONTHLY > 0 ? DEFAULT_MONTHLY : 30;
    const monthStart = utcMonthStartIso();
    const { count: monthCount } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("request_type", ["ad_variants", "ad_refine"])
      .eq("openai_called", true)
      .eq("success", true)
      .gte("created_at", monthStart);

    if ((monthCount ?? 0) >= monthlyLimit) {
      return new Response(
        JSON.stringify({
          error: `Monthly AI limit reached (${monthlyLimit}). Resets on the 1st.`,
          error_code: "MONTHLY_LIMIT",
          quota: { used: monthCount ?? 0, limit: monthlyLimit, remaining: 0 },
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /**
     * Cooldown — applied to BOTH initial generations and revisions to prevent abuse.
     * Revisions get a much shorter window (10s) because the user is actively iterating;
     * initial generations get the full configured cooldown.
     */
    const cooldownMs = isRevision ? 10_000 : Math.max(10, COOLDOWN_SEC) * 1000;
    const { data: recentCall } = await admin
      .from("ai_generation_logs")
      .select("id, created_at")
      .eq("business_id", businessId)
      .in("request_type", ["ad_variants", "ad_refine"])
      .eq("success", true)
      .gte("created_at", new Date(Date.now() - cooldownMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentCall) {
      const elapsedMs = Date.now() - new Date(recentCall.created_at as string).getTime();
      const waitSeconds = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
      return new Response(
        JSON.stringify({
          error: `Please wait ${waitSeconds}s before generating again.`,
          error_code: "COOLDOWN_ACTIVE",
          wait_seconds: waitSeconds,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /**
     * Revision-cap — derived server-side from logs (NOT trusted from client).
     * Counts ad_refine rows since the most recent ad_variants row for this business.
     * Without this, a client could send revision_count: 0 forever to bypass the cap.
     */
    let derivedRevisionCount = 0;
    if (isRevision) {
      const { data: lastInitial } = await admin
        .from("ai_generation_logs")
        .select("created_at")
        .eq("business_id", businessId)
        .eq("request_type", "ad_variants")
        .eq("success", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sinceIso = lastInitial?.created_at
        ? new Date(lastInitial.created_at as string).toISOString()
        : new Date(Date.now() - 60 * 60 * 1000).toISOString(); // fallback: last hour
      const { count: refineCount } = await admin
        .from("ai_generation_logs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("request_type", "ad_refine")
        .eq("success", true)
        .gte("created_at", sinceIso);
      derivedRevisionCount = refineCount ?? 0;
      if (derivedRevisionCount >= MAX_REVISION_COUNT) {
        return new Response(
          JSON.stringify({
            error: "You've revised this ad enough times. Start fresh with a new offer.",
            error_code: "REVISION_LIMIT",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (!openAiKey) {
      return new Response(
        JSON.stringify({
          error: "AI is not configured for this account. Contact support.",
          error_code: "OPENAI_KEY_MISSING",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build a SingleAd by running the right stages ──
    const previousAd = isRevision ? coerceSingleAd(previousAdRaw as Record<string, unknown>) : null;
    const sourceHint = hintText || previousAd?.item_research.item_name || "";

    let research: ItemResearch;
    if (isRevision && previousAd) {
      // Reuse research from the previous ad — revisions iterate, they don't re-look up
      research = previousAd.item_research;
    } else {
      research = await researchMenuItem({
        openAiKey,
        itemHint: sourceHint,
        businessName,
        businessLocation: businessContext.location ?? "",
      });
    }

    let copy: Pick<SingleAd, "headline" | "subheadline" | "short_description" | "push_notification" | "terms_summary" | "cta">;
    if (isRevision && previousAd && revisionTarget === "image") {
      // Image-only revision: keep copy
      copy = {
        headline: previousAd.headline,
        subheadline: previousAd.subheadline,
        short_description: previousAd.short_description || previousAd.subheadline,
        push_notification: previousAd.push_notification || previousAd.headline,
        terms_summary: previousAd.terms_summary || previousAd.subheadline,
        cta: previousAd.cta,
      };
    } else {
      try {
        copy = await generateCopy({
          openAiKey,
          itemHint: sourceHint,
          research,
          businessName,
          businessContext,
          offerScheduleSummary,
          quantityLimit,
          redemptionLimit,
          outputLanguage,
          revisionPreset: revisionPreset || undefined,
          revisionFeedback: revisionFeedback || undefined,
          previousAd: previousAd ?? undefined,
        });
      } catch (e) {
        console.log(
          JSON.stringify({ tag: "ai_ads_v2", event: "copy_error", err: String(e).slice(0, 300) }),
        );
        await admin.from("ai_generation_logs").insert({
          business_id: businessId,
          user_id: user.id,
          request_type: "ad_variants",
          input_mode: photoPath ? "photo" : "text",
          request_hash: "copy_error_v3",
          prompt_version: AD_COPY_PROMPT_VERSION,
          model: CHAT_MODEL,
          success: false,
          failure_reason: String(e).slice(0, 100),
          openai_called: true,
        });
        return new Response(
          JSON.stringify({ error: "AI copy generation failed. Tap try again.", error_code: "COPY_FAILED" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Guarantee a publishable offer phrase — the model usually writes one, but
    // when it doesn't, the deal would be blocked by the strong-deal guard at publish.
    copy = ensureOfferPhrase(copy, outputLanguage, research.item_name || sourceHint);

    let imageResult: Awaited<ReturnType<typeof produceImage>>;
    if (isRevision && previousAd && revisionTarget === "copy") {
      // Copy-only revision: keep image
      imageResult = {
        posterStoragePath: previousAd.poster_storage_path ?? null,
        source: previousAd.photo_source,
        treatment: previousAd.photo_treatment,
      };
    } else {
      imageResult = await produceImage({
        openAiKey,
        admin,
        userClient,
        businessId,
        photoPath: photoPath || null,
        photoTreatment,
        research,
        itemHint: sourceHint,
        businessName,
      });
    }

    const ad: SingleAd = {
      headline: copy.headline,
      subheadline: copy.subheadline,
      short_description: copy.short_description,
      push_notification: copy.push_notification,
      terms_summary: copy.terms_summary,
      cta: copy.cta,
      item_research: research,
      photo_source: imageResult.source,
      photo_treatment: imageResult.treatment,
      poster_storage_path: imageResult.posterStoragePath,
    };

    /**
     * Mark log as failure (no quota tick, no rate-limit clock) when image production failed
     * AND there was no uploaded photo to fall back on. The user got a textless ad — they
     * shouldn't burn quota for it.
     */
    const imageProductionFailed = imageResult.posterStoragePath === null;
    const productionSuccess = !imageProductionFailed;

    await admin.from("ai_generation_logs").insert({
      business_id: businessId,
      user_id: user.id,
      request_type: isRevision ? "ad_refine" : "ad_variants",
      input_mode: photoPath ? "photo" : "text",
      request_hash: `v3:${derivedRevisionCount}:${imageResult.source}`,
      prompt_version: AD_COPY_PROMPT_VERSION,
      model: CHAT_MODEL,
      success: productionSuccess,
      failure_reason: productionSuccess ? null : "IMAGE_NULL",
      openai_called: true,
    });

    /** Quota only ticks on a real successful production (matches the log row above). */
    const updatedUsed = (monthCount ?? 0) + (productionSuccess ? 1 : 0);
    const quota = {
      used: updatedUsed,
      limit: monthlyLimit,
      remaining: Math.max(0, monthlyLimit - updatedUsed),
    };

    return new Response(JSON.stringify({ ad, ads: [ad], quota }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.log(JSON.stringify({ tag: "ai_ads_v2", event: "fatal", err: String(e).slice(0, 400) }));
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function coerceSingleAd(raw: Record<string, unknown>): SingleAd {
  const research = (raw.item_research ?? {}) as Partial<ItemResearch>;
  const photoSourceRaw = typeof raw.photo_source === "string" ? raw.photo_source : "generated";
  const photoSource: SingleAd["photo_source"] =
    photoSourceRaw === "uploaded_original" || photoSourceRaw === "uploaded_enhanced"
      ? photoSourceRaw
      : "generated";
  const photoTreatmentRaw = typeof raw.photo_treatment === "string" ? raw.photo_treatment : "";
  const photoTreatment: PhotoTreatment | null =
    VALID_PHOTO_TREATMENTS.has(photoTreatmentRaw as PhotoTreatment)
      ? (photoTreatmentRaw as PhotoTreatment)
      : null;

  const shortDescription = clip(
    typeof raw.short_description === "string"
      ? raw.short_description
      : typeof raw.subheadline === "string"
      ? raw.subheadline
      : "",
    220,
  );

  return {
    headline: clip(typeof raw.headline === "string" ? raw.headline : "", 70),
    subheadline: shortDescription,
    short_description: shortDescription,
    push_notification: clip(
      typeof raw.push_notification === "string" ? raw.push_notification : "",
      90,
    ),
    terms_summary: clip(
      typeof raw.terms_summary === "string" ? raw.terms_summary : shortDescription,
      240,
    ),
    cta: clip(typeof raw.cta === "string" ? raw.cta : "", 26),
    item_research: {
      item_name: clip(typeof research.item_name === "string" ? research.item_name : "", 80),
      description: clip(typeof research.description === "string" ? research.description : "", 280),
      is_familiar: research.is_familiar === true,
    },
    photo_source: photoSource,
    photo_treatment: photoTreatment,
    poster_storage_path:
      typeof raw.poster_storage_path === "string" && raw.poster_storage_path.length > 0
        ? raw.poster_storage_path
        : null,
  };
}
