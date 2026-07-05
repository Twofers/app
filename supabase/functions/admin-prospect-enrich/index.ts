import {
  audit,
  cleanString,
  json,
  nullableString,
  numberInRange,
  readPayload,
  requireAdmin,
  type AdminContext,
  UUID_RE,
} from "../_shared/admin-prospects.ts";
import {
  adminAiSystemPrompt,
  ADMIN_AI_PROMPT_VERSIONS,
  generateAdminAiJson,
} from "../_shared/admin-ai.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const ENRICHMENT_SCHEMA = {
  name: "admin_prospect_enrichment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      cleaned_business_name: { type: "string" },
      likely_business_category: { type: "string" },
      short_business_summary: { type: "string" },
      likely_best_customer_segment: { type: "string" },
      likely_slow_period_hypothesis: { type: "string" },
      possible_promotable_items: { type: "array", items: { type: "string" } },
      suggested_first_limited_time_local_offer_ideas: { type: "array", items: { type: "string" } },
      website_social_summary: { type: "string" },
      missing_information: { type: "array", items: { type: "string" } },
      red_flags: { type: "array", items: { type: "string" } },
      source_notes: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            url: { type: "string" },
            notes: { type: "string" },
          },
          required: ["label", "url", "notes"],
        },
      },
      warnings: { type: "array", items: { type: "string" } },
      review_status: { type: "string" },
      requires_human_review: { type: "boolean" },
      safe_for_public_display: { type: "boolean" },
    },
    required: [
      "cleaned_business_name",
      "likely_business_category",
      "short_business_summary",
      "likely_best_customer_segment",
      "likely_slow_period_hypothesis",
      "possible_promotable_items",
      "suggested_first_limited_time_local_offer_ideas",
      "website_social_summary",
      "missing_information",
      "red_flags",
      "source_notes",
      "confidence",
      "sources",
      "warnings",
      "review_status",
      "requires_human_review",
      "safe_for_public_display",
    ],
  },
};

function safeReviewStatus(value: unknown): string {
  const cleaned = cleanString(value, 40);
  return ["needs_review", "approved", "rejected", "superseded"].includes(cleaned) ? cleaned : "needs_review";
}

function buildFallbackEnrichment(
  prospect: Record<string, unknown>,
  supplied: Record<string, unknown>,
) {
  const category = cleanString(supplied.category ?? prospect.category, 80) || "local business";
  const city = cleanString(prospect.city, 80) || "the launch area";
  const suggestedFirstOfferWindow = /cafe|coffee|bakery|restaurant/i.test(category)
    ? "weekday lunch or mid-afternoon"
    : "a controlled slower window";
  return {
    cleaned_business_name: cleanString(supplied.cleaned_business_name ?? prospect.display_name, 160) ||
      String(prospect.display_name ?? ""),
    likely_business_category: category,
    short_business_summary: `${prospect.display_name} appears to be a ${category} in ${city}. Confirm details before any public use.`,
    likely_best_customer_segment: "Nearby customers looking for local offers from independent businesses.",
    likely_slow_period_hypothesis: suggestedFirstOfferWindow,
    possible_promotable_items: [],
    suggested_first_limited_time_local_offer_ideas: [
      `Test a limited-time local offer during ${suggestedFirstOfferWindow}.`,
    ],
    website_social_summary: cleanString(supplied.website_social_summary, 600) || "No reviewed website or social source was supplied.",
    missing_information: [
      "Owner or manager contact",
      "Confirmed hours and slow periods",
      "Approved public business facts",
    ],
    red_flags: [],
    source_notes: ["Generated from internal prospect fields and any admin-supplied source notes."],
    confidence: numberInRange(supplied.confidence, 0.55, 0, 1) ?? 0.55,
    sources: [],
    warnings: [
      "Admin review is required before any facts are approved.",
      "Do not create a live offer from an unclaimed prospect.",
    ],
    review_status: "needs_review",
    requires_human_review: true,
    safe_for_public_display: false,
  };
}

function selectedFactPatch(selected: unknown): Record<string, unknown> {
  const input = selected && typeof selected === "object" ? selected as Record<string, unknown> : {};
  const patch: Record<string, unknown> = {};
  for (const [key, max] of [
    ["display_name", 160],
    ["category", 80],
    ["subcategory", 80],
    ["address_line1", 240],
    ["city", 80],
    ["state", 20],
    ["postal_code", 20],
  ] as const) {
    const value = cleanString(input[key], max);
    if (value) patch[key] = value;
  }
  return patch;
}

async function reviewEnrichment(
  req: Request,
  ctx: AdminContext,
  payload: Record<string, unknown>,
  requestId: string,
) {
  const prospectId = cleanString(payload.prospect_id, 80);
  const enrichmentId = cleanString(payload.enrichment_id, 80);
  const action = cleanString(payload.action, 80);
  if (!UUID_RE.test(prospectId)) {
    return json(req, { error: "Prospect is required.", request_id: requestId }, 400);
  }

  let query = ctx.supabaseAdmin
    .from("business_prospect_enrichments")
    .select("id,prospect_id,review_status,enrichment_json")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (UUID_RE.test(enrichmentId)) query = query.eq("id", enrichmentId);
  const { data, error } = await query;
  if (error) throw error;
  const enrichment = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!enrichment) return json(req, { error: "Enrichment not found.", request_id: requestId }, 404);

  const nextReviewStatus = action === "reject_ai_facts" ? "rejected" : action === "mark_needs_manual_research" ? "needs_review" : "approved";
  await ctx.supabaseAdmin
    .from("business_prospect_enrichments")
    .update({
      review_status: nextReviewStatus,
      reviewed_by_admin_user_id: ctx.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", enrichment.id);

  const prospectPatch: Record<string, unknown> = {};
  if (action === "approve_selected_facts") {
    Object.assign(prospectPatch, selectedFactPatch(payload.selected_facts));
    prospectPatch.review_status = "approved";
    prospectPatch.status = "ready_to_contact";
    prospectPatch.last_verified_at = new Date().toISOString();
  } else if (action === "reject_ai_facts") {
    prospectPatch.review_status = "needs_review";
  } else {
    prospectPatch.review_status = "needs_review";
    prospectPatch.status = "stale";
  }

  await ctx.supabaseAdmin.from("business_prospects").update(prospectPatch).eq("id", prospectId);
  await audit(ctx, {
    action: action === "approve_selected_facts"
      ? "admin_prospect_ai_facts_approved"
      : action === "reject_ai_facts"
      ? "admin_prospect_ai_facts_rejected"
      : "admin_prospect_needs_manual_research",
    targetType: "business_prospect",
    targetId: prospectId,
    beforeValue: { enrichment_review_status: enrichment.review_status },
    afterValue: { enrichment_id: enrichment.id, review_status: nextReviewStatus, prospect_patch: prospectPatch },
    reason: nullableString(payload.reason, 500) || action,
  });

  return json(req, { ok: true, request_id: requestId, enrichment_id: enrichment.id, review_status: nextReviewStatus });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  const requestId = crypto.randomUUID();

  try {
    const ctx = await requireAdmin(req, requestId, "prospect.enrich");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const action = cleanString(payload.action, 80) || "run";
    if (["approve_selected_facts", "reject_ai_facts", "mark_needs_manual_research"].includes(action)) {
      return reviewEnrichment(req, ctx, payload, requestId);
    }

    const prospectId = cleanString(payload.prospect_id, 80);
    if (!UUID_RE.test(prospectId)) {
      return json(req, { error: "Prospect is required.", request_id: requestId }, 400);
    }

    const [prospectResult, sourcesResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("business_prospects")
        .select("id,display_name,category,subcategory,address_line1,address_line2,city,state,postal_code,review_status,status,source_confidence,private_contact_json")
        .eq("id", prospectId)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("business_prospect_sources")
        .select("provider,source_url,source_payload_hash,confidence,fetched_at,stale_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    if (prospectResult.error) throw prospectResult.error;
    if (sourcesResult.error) throw sourcesResult.error;
    const prospect = prospectResult.data as Record<string, unknown> | null;
    if (!prospect) return json(req, { error: "Prospect not found.", request_id: requestId }, 404);

    const supplied = payload.enrichment_json && typeof payload.enrichment_json === "object"
      ? payload.enrichment_json as Record<string, unknown>
      : {};
    const mode = ["quick", "full", "refresh", "verify"].includes(cleanString(payload.mode, 20))
      ? cleanString(payload.mode, 20)
      : "quick";
    const sourceUrls = Array.isArray(payload.source_urls) ? payload.source_urls.map((value) => cleanString(value, 500)).filter(Boolean) : [];
    const fallback = buildFallbackEnrichment(prospect, supplied);
    const sourceRows = (sourcesResult.data ?? []) as Array<Record<string, unknown>>;
    const ai = await generateAdminAiJson({
      ctx,
      feature: "prospect_enrichment",
      promptVersion: ADMIN_AI_PROMPT_VERSIONS.prospect_enrichment,
      systemPrompt: adminAiSystemPrompt("prospect_enrichment"),
      userPrompt: JSON.stringify({
        mode,
        prospect: {
          id: prospect.id,
          display_name: prospect.display_name,
          category: prospect.category,
          subcategory: prospect.subcategory,
          city: prospect.city,
          state: prospect.state,
          postal_code: prospect.postal_code,
          review_status: prospect.review_status,
          status: prospect.status,
          source_confidence: prospect.source_confidence,
        },
        source_urls: sourceUrls,
        stored_source_notes: sourceRows.map((row) => ({
          provider: row.provider,
          source_url: row.source_url,
          confidence: row.confidence,
          fetched_at: row.fetched_at,
          stale_at: row.stale_at,
        })),
        admin_notes: cleanString(payload.admin_notes, 1200),
        category_focus: cleanString(payload.category_focus, 120),
      }),
      jsonSchema: ENRICHMENT_SCHEMA,
      fallbackValue: fallback,
      relatedProspectId: prospectId,
      inputSummary: {
        prospect_id: prospectId,
        mode,
        source_url_count: sourceUrls.length,
        stored_source_count: sourceRows.length,
      },
      defaultSources: sourceRows.map((row) => ({
        label: String(row.provider ?? "stored source"),
        url: typeof row.source_url === "string" ? row.source_url : null,
        notes: row.confidence == null ? null : `confidence ${row.confidence}`,
      })),
      defaultConfidence: numberInRange(payload.confidence, fallback.confidence, 0, 1) ?? fallback.confidence,
      requiresHumanReview: true,
      safeForPublicDisplay: false,
    });
    const reviewStatus = safeReviewStatus(payload.review_status);

    const { data: enrichment, error: insertError } = await ctx.supabaseAdmin
      .from("business_prospect_enrichments")
      .insert({
        prospect_id: prospectId,
        provider: ai.provider,
        model: ai.model,
        prompt_version: ai.promptVersion,
        enrichment_json: ai.output,
        confidence: ai.output.confidence,
        review_status: reviewStatus,
        reviewed_by_admin_user_id: reviewStatus === "approved" || reviewStatus === "rejected" ? ctx.user.id : null,
        reviewed_at: reviewStatus === "approved" || reviewStatus === "rejected" ? new Date().toISOString() : null,
      })
      .select("id,prospect_id,provider,model,prompt_version,review_status,confidence,created_at")
      .single();
    if (insertError) throw insertError;

    const prospectPatch: Record<string, unknown> = { status: "enriched" };
    if (reviewStatus === "approved") {
      prospectPatch.review_status = "approved";
      prospectPatch.last_verified_at = new Date().toISOString();
    }
    await ctx.supabaseAdmin.from("business_prospects").update(prospectPatch).eq("id", prospectId);
    await ctx.supabaseAdmin
      .from("sales_accounts")
      .upsert({
        prospect_id: prospectId,
        stage: "enriched",
        next_action: "Review AI facts, score prospect, and prepare outreach",
      }, { onConflict: "prospect_id" });

    await audit(ctx, {
      action: "admin_prospect_enriched",
      targetType: "business_prospect",
      targetId: prospectId,
      afterValue: {
        enrichment_id: enrichment.id,
        review_status: reviewStatus,
        provider: ai.provider,
        model: ai.model,
        prompt_version: ai.promptVersion,
      },
      reason: nullableString(payload.reason, 500) || "prospect_enrichment",
    });

    return json(req, { ok: true, request_id: requestId, enrichment, enrichment_json: ai.output });
  } catch (error) {
    if (String((error as Error)?.message ?? "") === "ADMIN_AI_RATE_LIMITED") {
      return json(req, { error: "Too many admin AI requests in the last hour. Try again later.", request_id: requestId }, 429);
    }
    console.error("[admin-prospect-enrich] error:", error);
    return json(req, { error: "Failed to enrich prospect.", request_id: requestId }, 500);
  }
});
