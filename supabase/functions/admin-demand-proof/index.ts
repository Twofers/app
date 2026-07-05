import {
  audit,
  cleanString,
  json,
  readPayload,
  requireAdmin,
  UUID_RE,
} from "../_shared/admin-prospects.ts";
import {
  adminAiSystemPrompt,
  ADMIN_AI_PROMPT_VERSIONS,
  generateAdminAiJson,
} from "../_shared/admin-ai.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const MIN_UNIQUE_USERS = 5;

const DEMAND_PROOF_SCHEMA = {
  name: "admin_demand_proof",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      merchant_safe_summary: { type: "string" },
      suggested_pitch: { type: "string" },
      suggested_first_offer_window: { type: "string" },
      suggested_offer_structure: { type: "string" },
      what_to_say_in_person: { type: "array", items: { type: "string" } },
      what_not_to_say: { type: "array", items: { type: "string" } },
      privacy_safe_stats: { type: "array", items: { type: "string" } },
      email_pitch: { type: "string" },
      sms_pitch: { type: "string" },
      owner_summary: { type: "string" },
      internal_notes: { type: "string" },
      caveats: { type: "array", items: { type: "string" } },
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
      "merchant_safe_summary",
      "suggested_pitch",
      "suggested_first_offer_window",
      "suggested_offer_structure",
      "what_to_say_in_person",
      "what_not_to_say",
      "privacy_safe_stats",
      "email_pitch",
      "sms_pitch",
      "owner_summary",
      "internal_notes",
      "caveats",
      "confidence",
      "sources",
      "warnings",
      "review_status",
      "requires_human_review",
      "safe_for_public_display",
    ],
  },
};

type DemandAggregate = {
  favorites: number;
  requests: number;
  views: number;
  notificationEnabled: number;
  uniqueUsers: number;
};

function offerWindow(category: unknown): string {
  const text = String(category ?? "").toLowerCase();
  if (/(coffee|cafe|bakery)/.test(text)) return "weekday lunch or mid-afternoon";
  if (/restaurant/.test(text)) return "weekday lunch or early dinner";
  return "a controlled slow-hour window";
}

function safeStats(aggregate: DemandAggregate, thresholdMet: boolean): string[] {
  if (!thresholdMet) {
    return [
      `Demand is below the ${MIN_UNIQUE_USERS}-unique-user threshold, so only broad interest language is safe.`,
      "People near this area have shown early interest.",
    ];
  }
  const totalDemand = aggregate.favorites + aggregate.requests + aggregate.views;
  return [
    `${totalDemand} aggregate local interest signals in the recent window.`,
    `${aggregate.requests + aggregate.favorites} aggregate request or favorite signals.`,
    `${aggregate.uniqueUsers} or more unique local users contributed to the safe aggregate.`,
  ];
}

function fallbackDemandProof(
  target: Record<string, unknown>,
  aggregate: DemandAggregate,
  targetIsProspect: boolean,
) {
  const thresholdMet = aggregate.uniqueUsers >= MIN_UNIQUE_USERS;
  const targetName = String(target.display_name ?? target.name ?? "this business");
  const window = offerWindow(target.category);
  const merchantSafeSummary = thresholdMet
    ? `Local users have requested updates from ${targetName}. This is an early demand signal, not a guarantee of sales.`
    : "People near this area have shown early interest. The cohort is still too small for detailed merchant-facing stats.";
  return {
    merchant_safe_summary: merchantSafeSummary,
    suggested_pitch: `${merchantSafeSummary} Twofer can help test a limited-time local offer during ${window}, with owner approval before anything goes live.`,
    suggested_first_offer_window: window,
    suggested_offer_structure: "Start with a small, limited-time local offer with a clear quantity cap and staff instructions.",
    what_to_say_in_person: [
      "This is an early demand signal, not a guarantee of sales.",
      "Nothing is active until an owner or manager claims and approves setup.",
      `A good first test could run during ${window}.`,
    ],
    what_not_to_say: [
      "Do not name customers.",
      "Do not say the business is already a partner unless it is claimed and approved.",
      "Do not promise revenue or foot traffic.",
    ],
    privacy_safe_stats: safeStats(aggregate, thresholdMet),
    email_pitch: `${merchantSafeSummary} Would you like a secure claim link to review a founding trial?`,
    sms_pitch: "Twofer is inviting selected local businesses to review early local demand and a founding trial. May I send the owner a secure claim link?",
    owner_summary: merchantSafeSummary,
    internal_notes: targetIsProspect
      ? "Unclaimed prospect. Keep all copy review-only until the business is claimed and approved."
      : "Claimed business or admin-linked business. Confirm billing/trial state before sales promises.",
    caveats: ["Aggregate demand does not guarantee sales.", "Counts below threshold are withheld."],
    confidence: thresholdMet ? 0.72 : 0.46,
    sources: [],
    warnings: thresholdMet ? [] : ["Demand proof is below threshold; do not show specific counts."],
    review_status: "needs_review",
    requires_human_review: true,
    safe_for_public_display: thresholdMet,
  };
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
    const ctx = await requireAdmin(req, requestId, "demand.read");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const prospectId = cleanString(payload.prospect_id, 80);
    const businessId = cleanString(payload.business_id, 80);
    if ((!UUID_RE.test(prospectId) && !UUID_RE.test(businessId)) || (UUID_RE.test(prospectId) && UUID_RE.test(businessId))) {
      return json(req, { error: "Choose one prospect or business.", request_id: requestId }, 400);
    }

    const targetIsProspect = UUID_RE.test(prospectId);
    const targetResult = targetIsProspect
      ? await ctx.supabaseAdmin
        .from("business_prospects")
        .select("id,display_name,category,city,launch_area_id,status,review_status,public_label_state")
        .eq("id", prospectId)
        .maybeSingle()
      : await ctx.supabaseAdmin
        .from("businesses")
        .select("id,name,category,city,launch_area_id,status,access_level,verification_status")
        .eq("id", businessId)
        .maybeSingle();
    if (targetResult.error) throw targetResult.error;
    const target = targetResult.data as Record<string, unknown> | null;
    if (!target) return json(req, { error: "Target not found.", request_id: requestId }, 404);

    let rollupQuery = ctx.supabaseAdmin
      .from("business_demand_rollups")
      .select("favorites_count,requests_count,views_count,unique_users_count,notification_enabled_count,city,rollup_date")
      .gte("rollup_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    rollupQuery = targetIsProspect ? rollupQuery.eq("prospect_id", prospectId) : rollupQuery.eq("business_id", businessId);
    const { data: rollups, error: rollupError } = await rollupQuery;
    if (rollupError) throw rollupError;

    const aggregate = ((rollups ?? []) as Array<Record<string, unknown>>).reduce<DemandAggregate>((acc, row) => ({
      favorites: acc.favorites + (Number(row.favorites_count) || 0),
      requests: acc.requests + (Number(row.requests_count) || 0),
      views: acc.views + (Number(row.views_count) || 0),
      notificationEnabled: acc.notificationEnabled + (Number(row.notification_enabled_count) || 0),
      uniqueUsers: Math.max(acc.uniqueUsers, Number(row.unique_users_count) || 0),
    }), { favorites: 0, requests: 0, views: 0, notificationEnabled: 0, uniqueUsers: 0 });

    const thresholdMet = aggregate.uniqueUsers >= MIN_UNIQUE_USERS;
    const redactedAggregate = thresholdMet
      ? aggregate
      : {
          uniqueUsers: aggregate.uniqueUsers,
          favorites: null,
          requests: null,
          views: null,
          notificationEnabled: null,
        };
    const fallback = fallbackDemandProof(target, aggregate, targetIsProspect);
    const ai = await generateAdminAiJson({
      ctx,
      feature: "demand_proof",
      promptVersion: ADMIN_AI_PROMPT_VERSIONS.demand_proof,
      systemPrompt: adminAiSystemPrompt("demand_proof"),
      userPrompt: JSON.stringify({
        target_type: targetIsProspect ? "prospect" : "business",
        target: {
          id: target.id,
          name: target.display_name ?? target.name,
          category: target.category,
          city: target.city,
          status: target.status,
          review_status: target.review_status ?? null,
          public_label_state: target.public_label_state ?? null,
        },
        privacy_threshold: {
          min_unique_users: MIN_UNIQUE_USERS,
          threshold_met: thresholdMet,
        },
        demand_rollup: redactedAggregate,
        sales_stage: cleanString(payload.sales_stage, 80),
        business_type: cleanString(payload.business_type, 80),
      }),
      jsonSchema: DEMAND_PROOF_SCHEMA,
      fallbackValue: fallback,
      relatedProspectId: targetIsProspect ? prospectId : null,
      relatedBusinessId: targetIsProspect ? null : businessId,
      inputSummary: {
        target_type: targetIsProspect ? "prospect" : "business",
        target_id: targetIsProspect ? prospectId : businessId,
        threshold_met: thresholdMet,
        unique_users_count: aggregate.uniqueUsers,
      },
      defaultConfidence: fallback.confidence,
      defaultWarnings: fallback.warnings,
      requiresHumanReview: true,
      safeForPublicDisplay: thresholdMet,
    });

    const report = {
      target_type: targetIsProspect ? "prospect" : "business",
      target_id: targetIsProspect ? prospectId : businessId,
      display_name: target.display_name ?? target.name,
      city: target.city ?? null,
      threshold_met: thresholdMet,
      threshold_min_unique_users: MIN_UNIQUE_USERS,
      aggregate: redactedAggregate,
      merchant_safe_lines: [
        ai.output.merchant_safe_summary,
        ai.output.suggested_pitch,
        ...(Array.isArray(ai.output.privacy_safe_stats) ? ai.output.privacy_safe_stats : []),
      ].filter(Boolean),
      exports: {
        in_person_pitch: Array.isArray(ai.output.what_to_say_in_person)
          ? ai.output.what_to_say_in_person.join("\n")
          : ai.output.suggested_pitch,
        email_pitch: ai.output.email_pitch,
        text_message_pitch: ai.output.sms_pitch,
        owner_summary: ai.output.owner_summary,
        internal_notes: ai.output.internal_notes,
      },
      ai: ai.output,
    };

    await audit(ctx, {
      action: "admin_demand_proof_generated",
      targetType: targetIsProspect ? "business_prospect" : "business",
      targetId: targetIsProspect ? prospectId : businessId,
      businessId: targetIsProspect ? null : businessId,
      afterValue: {
        threshold_met: thresholdMet,
        unique_users_count: aggregate.uniqueUsers,
        provider: ai.provider,
        model: ai.model,
      },
      reason: cleanString(payload.reason, 500) || "demand_proof",
    });

    return json(req, { ok: true, request_id: requestId, report });
  } catch (error) {
    if (String((error as Error)?.message ?? "") === "ADMIN_AI_RATE_LIMITED") {
      return json(req, { error: "Too many admin AI requests in the last hour. Try again later.", request_id: requestId }, 429);
    }
    console.error("[admin-demand-proof] error:", error);
    return json(req, { error: "Failed to generate demand proof.", request_id: requestId }, 500);
  }
});
