/**
 * ai-generate-ad-variants — TWOFER ad generator (single-ad pipeline).
 *
 * Quality-first rewrite (2026-05-01):
 * - Stage 1: optional web research for unfamiliar menu items (gpt-4o-search-preview).
 * - Stage 2: copy generation tuned for an item-forward, anti-AI-tell voice.
 * - Stage 3: image — enhance the cafe's uploaded photo (touchup / cleanbg / studiopolish)
 *            OR fall back to DALL-E 3 (natural style, HD) when no photo is provided.
 *
 * The app renders the headline/subline/CTA ABOVE the image — text is never baked in.
 *
 * Returns a single ad. For backward compatibility with old clients, the response also
 * includes `ads: [ad]` so existing UI that expects an array does not crash.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type { SupabaseClient as SupabaseClientType } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient, userClient } from "../_shared/auth-clients.ts";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { DEFAULT_MONTHLY_LIMIT, DEFAULT_COOLDOWN_SEC } from "../_shared/ai-limits.ts";
import { isDemoUserEmail } from "./demo-variants.ts";
import {
  buildPhotoAdImagePrompt,
  enhanceUploadedPhoto,
  generatePhotoAdImage,
  type PhotoTreatment,
} from "../_shared/dalle-image.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const CHAT_MODEL = resolveOpenAiChatModel();
const RESEARCH_MODEL = "gpt-4o-search-preview";
const DEFAULT_MONTHLY = DEFAULT_MONTHLY_LIMIT;
const COOLDOWN_SEC = DEFAULT_COOLDOWN_SEC;

/** Hard cap to bound abuse. The client enforces a soft cap (5) for UX. */
const MAX_REVISION_COUNT = 10;

const VALID_PHOTO_TREATMENTS: ReadonlySet<PhotoTreatment> = new Set([
  "touchup",
  "cleanbg",
  "studiopolish",
]);
const VALID_REVISION_TARGETS = new Set(["copy", "image", "both"] as const);

type RevisionTarget = "copy" | "image" | "both";

type BusinessContext = {
  category?: string;
  tone?: string;
  location?: string;
  description?: string;
};

type ItemResearch = {
  /** Cleaned up item name as the AI understood it. */
  item_name: string;
  /** 1-2 sentences explaining what the item is + what makes it unique. Empty if unfamiliar. */
  description: string;
  /** True if the AI had useful information; false if it gave up. */
  is_familiar: boolean;
};

type SingleAd = {
  /** Short, item-forward (≤40 chars). */
  headline: string;
  /** One sentence — explains what the item is OR why it's worth the trip (≤88 chars). */
  subheadline: string;
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
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 220,
    };
    // gpt-4o-search-preview rejects temperature; standard models accept it
    if (!isWebSearch) {
      body.temperature = 0.4;
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

const COPY_VOICE_RULES = [
  "Write like the cafe owner would write it — direct, item-forward, confident.",
  'Headline format: name the item and the offer. Example: "BOGO Large Iced Americano".',
  "If the item is unique or unfamiliar (research flagged it), the subline must explain what it is in plain words.",
  "If the item is common, the subline can lean into what makes their version worth coming for.",
  "",
  "BANNED — these are the AI tells we are removing:",
  "  - No exclamation marks anywhere.",
  '  - No em dashes ("—") in the copy.',
  '  - No "treat yourself", "indulge", "amazing", "incredible", "best", "ultimate", "perfect", "experience".',
  '  - No "hand-pulled", "small-batch", "single-origin", "artisan", "craft" unless the cafe owner used those words.',
  '  - No "today only", "limited time", "act fast", "don\'t miss out" unless the schedule literally says so.',
  "  - No rule of three (do not list three adjectives or three benefits in a row).",
  "  - No emojis.",
  "  - No questions in the headline.",
  "",
  "CTA: a short verb phrase the customer takes. Examples: \"Claim deal\", \"Get yours\", \"Order today\". Not a sentence.",
  "",
  "Length limits (hard): headline ≤ 40 chars, subline ≤ 88 chars, CTA ≤ 26 chars.",
  "If a length is exceeded, rewrite shorter — never truncate mid-word.",
];

async function generateCopy(params: {
  openAiKey: string;
  itemHint: string;
  research: ItemResearch;
  businessName: string;
  businessContext: BusinessContext;
  offerScheduleSummary: string;
  outputLanguage: "en" | "es" | "ko";
  revisionPreset?: string;
  revisionFeedback?: string;
  previousAd?: SingleAd;
}): Promise<Pick<SingleAd, "headline" | "subheadline" | "cta">> {
  const {
    openAiKey,
    itemHint,
    research,
    businessName,
    businessContext,
    offerScheduleSummary,
    outputLanguage,
    revisionPreset,
    revisionFeedback,
    previousAd,
  } = params;

  const langName =
    outputLanguage === "es" ? "Spanish" : outputLanguage === "ko" ? "Korean" : "English";

  const facts: string[] = [];
  if (businessName) facts.push(`Business name: ${businessName}`);
  facts.push(`Owner note (highest priority — ground truth on what the deal is): ${itemHint || "(none)"}`);
  if (research.description) {
    facts.push(`Item context (use to inform the subline): ${research.description}`);
  }
  if (offerScheduleSummary) facts.push(`Schedule: ${offerScheduleSummary}`);
  if (businessContext.category) facts.push(`Cafe category: ${businessContext.category}`);
  if (businessContext.location) facts.push(`Neighborhood: ${businessContext.location}`);
  if (businessContext.tone) facts.push(`Tone hint (style only): ${businessContext.tone}`);

  const isRevision = !!previousAd;
  const revisionBlock: string[] = [];
  if (isRevision && previousAd) {
    revisionBlock.push("");
    revisionBlock.push("REVISION CONTEXT — the previous draft was:");
    revisionBlock.push(`  Headline: ${previousAd.headline}`);
    revisionBlock.push(`  Subline: ${previousAd.subheadline}`);
    revisionBlock.push(`  CTA: ${previousAd.cta}`);
    if (revisionPreset) {
      revisionBlock.push(`Apply this preset adjustment: ${revisionPreset}`);
    }
    if (revisionFeedback) {
      revisionBlock.push(`Apply this user feedback: ${revisionFeedback}`);
    }
    revisionBlock.push("Keep the same offer mechanics. Change wording per the adjustment.");
  }

  const system = [
    `Write a single mobile ad for a TWOFER cafe deal. Output JSON only. Write all text in ${langName}.`,
    "",
    ...COPY_VOICE_RULES,
  ].join("\n");

  const userText = [
    "FACTS:",
    ...facts.map((f) => "  " + f),
    ...revisionBlock,
  ].join("\n");

  const jsonSchema = {
    name: "single_ad",
    schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        subheadline: { type: "string" },
        cta: { type: "string" },
      },
      required: ["headline", "subheadline", "cta"],
      additionalProperties: false,
    },
  };

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
      max_tokens: 400,
      temperature: isRevision ? 0.7 : 0.6,
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
    subheadline?: string;
    cta?: string;
  };

  return {
    headline: clip(parsed.headline ?? "", 40),
    subheadline: clip(parsed.subheadline ?? "", 88),
    cta: clip(parsed.cta ?? "", 26),
  };
}

// ─── Stage 3: image ────────────────────────────────────────────────────────

type SupabaseClient = SupabaseClientType;

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

  // Path B — no photo: generate via DALL-E in photographic mode
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

// ─── Demo-mode stub (no OpenAI calls) ──────────────────────────────────────

function buildDemoSingleAd(itemHint: string): SingleAd {
  const item = itemHint.trim().slice(0, 30) || "your favorite drink";
  return {
    headline: clip(`BOGO ${item}`, 40),
    subheadline: clip(`Buy one ${item}, get the second one free.`, 88),
    cta: "Claim deal",
    item_research: { item_name: item, description: "", is_familiar: false },
    photo_source: "generated",
    photo_treatment: null,
    poster_storage_path: null,
  };
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
    const openAiKey = Deno.env.get("OPENAI_API_KEY");

    const userSupabase = userClient(req);
    const admin = adminClient();

    const {
      data: { user },
      error: userErr,
    } = await userSupabase.auth.getUser();
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

    const rawOutLang = typeof body.output_language === "string"
      ? body.output_language.trim().toLowerCase()
      : "en";
    const outputLanguage: "en" | "es" | "ko" =
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
    const { data: business, error: bizErr } = await userSupabase
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

    // Demo account: deterministic stub, no OpenAI cost
    const demoWantsLive = Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";
    if (isDemoUserEmail(user.email) && !demoWantsLive) {
      const ad = buildDemoSingleAd(hintText);
      await admin.from("ai_generation_logs").insert({
        business_id: businessId,
        user_id: user.id,
        request_type: "ad_variants",
        input_mode: "demo",
        request_hash: "demo_v2",
        prompt_version: "v2",
        model: "demo_mock",
        success: true,
        openai_called: false,
      });
      return new Response(JSON.stringify({ ad, ads: [ad] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    const previousAd = isRevision ? coerceSingleAd(previousAdRaw) : null;
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

    let copy: Pick<SingleAd, "headline" | "subheadline" | "cta">;
    if (isRevision && previousAd && revisionTarget === "image") {
      // Image-only revision: keep copy
      copy = {
        headline: previousAd.headline,
        subheadline: previousAd.subheadline,
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
          request_hash: "copy_error_v2",
          prompt_version: "v2",
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
        userClient: userSupabase,
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
      request_hash: `v2:${derivedRevisionCount}:${imageResult.source}`,
      prompt_version: "v2",
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

  return {
    headline: clip(typeof raw.headline === "string" ? raw.headline : "", 40),
    subheadline: clip(typeof raw.subheadline === "string" ? raw.subheadline : "", 88),
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
