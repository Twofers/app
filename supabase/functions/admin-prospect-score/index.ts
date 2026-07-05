import {
  audit,
  cleanString,
  json,
  nullableString,
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

const SCORE_SCHEMA = {
  name: "admin_prospect_score",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      total_score: { type: "integer" },
      tier: { type: "string" },
      score_components: {
        type: "object",
        additionalProperties: false,
        properties: {
          demand: { type: "integer" },
          category_fit: { type: "integer" },
          geography: { type: "integer" },
          business_type: { type: "integer" },
          slow_period_fit: { type: "integer" },
          source_confidence: { type: "integer" },
          sales_readiness: { type: "integer" },
          duplicate_risk: { type: "integer" },
        },
        required: [
          "demand",
          "category_fit",
          "geography",
          "business_type",
          "slow_period_fit",
          "source_confidence",
          "sales_readiness",
          "duplicate_risk",
        ],
      },
      recommended_next_action: { type: "string" },
      reason_summary: { type: "string" },
      risk_notes: { type: "array", items: { type: "string" } },
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
      "total_score",
      "tier",
      "score_components",
      "recommended_next_action",
      "reason_summary",
      "risk_notes",
      "confidence",
      "sources",
      "warnings",
      "review_status",
      "requires_human_review",
      "safe_for_public_display",
    ],
  },
};

function clampScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function categoryScore(category: unknown): number {
  const text = String(category ?? "").toLowerCase();
  if (/(coffee|cafe|bakery|restaurant|smoothie|juice)/.test(text)) return 18;
  if (/(retail|fitness|salon|dessert|tea)/.test(text)) return 12;
  return 6;
}

function geographyScore(city: unknown): number {
  const text = String(city ?? "").toLowerCase();
  if (/(irving|coppell|carrollton|las colinas|valley ranch)/.test(text)) return 16;
  if (/(dallas|fort worth|plano|addison|richardson)/.test(text)) return 10;
  return 4;
}

function tier(score: number, duplicateRisk: number): "A" | "B" | "C" | "Do Not Contact" {
  if (duplicateRisk <= -25 || score < 35) return "Do Not Contact";
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  return "C";
}

type DemandAggregate = {
  favorites: number;
  requests: number;
  views: number;
  uniqueUsers: number;
};

function buildDeterministicScore(input: {
  prospect: Record<string, unknown>;
  demand: DemandAggregate;
  latestSource?: Record<string, unknown>;
  latestEnrichment?: Record<string, unknown>;
}) {
  const demandComponent = Math.min(20, input.demand.requests * 3 + input.demand.favorites * 2 + Math.floor(input.demand.views / 12) + input.demand.uniqueUsers);
  const categoryFit = categoryScore(input.prospect.category);
  const geography = geographyScore(input.prospect.city);
  const businessType = /chain|franchise|national/i.test(String(input.prospect.display_name ?? "")) ? 2 : 10;
  const slowPeriodFit = /coffee|cafe|bakery|restaurant|salon|fitness/i.test(String(input.prospect.category ?? "")) ? 10 : 5;
  const sourceStale = input.latestSource?.stale_at && new Date(String(input.latestSource.stale_at)).getTime() < Date.now();
  const sourceConfidence = sourceStale ? 2 : Math.round((Number(input.latestSource?.confidence) || 0.5) * 10);
  const salesReadiness = input.latestEnrichment ? (input.latestEnrichment.review_status === "approved" ? 12 : 7) : 3;
  const duplicateRisk = input.prospect.duplicate_of_prospect_id ? -35 : 0;
  const reviewBonus = input.prospect.review_status === "approved" || input.prospect.review_status === "verified" ? 8 : 0;
  const total = clampScore(
    demandComponent + categoryFit + geography + businessType + slowPeriodFit + sourceConfidence + salesReadiness + duplicateRisk + reviewBonus,
  );
  const nextTier = tier(total, duplicateRisk);
  return {
    total_score: total,
    tier: nextTier,
    score_components: {
      demand: demandComponent,
      category_fit: categoryFit,
      geography,
      business_type: businessType,
      slow_period_fit: slowPeriodFit,
      source_confidence: sourceConfidence,
      sales_readiness: salesReadiness + reviewBonus,
      duplicate_risk: duplicateRisk,
    },
    recommended_next_action: input.prospect.duplicate_of_prospect_id
      ? "Review duplicate and link to the canonical prospect"
      : nextTier === "A"
      ? "Prepare demand proof and send a reviewed claim link"
      : nextTier === "B"
      ? "Assign sales owner and schedule outreach"
      : nextTier === "C"
      ? "Refresh enrichment before outreach"
      : "Do not contact until duplicate/geography/source risk is resolved",
    reason_summary: "Score is based on aggregate demand, launch geography, category fit, source freshness, review state, and duplicate risk.",
    risk_notes: input.prospect.duplicate_of_prospect_id ? ["Possible duplicate prospect."] : [],
    confidence: input.latestEnrichment ? 0.68 : 0.56,
    sources: [],
    warnings: ["Scoring inputs are admin-only and must not be shown publicly."],
    review_status: "needs_review",
    requires_human_review: true,
    safe_for_public_display: false,
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
    const ctx = await requireAdmin(req, requestId, "prospect.score");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const prospectId = cleanString(payload.prospect_id, 80);
    if (!UUID_RE.test(prospectId)) {
      return json(req, { error: "Prospect is required.", request_id: requestId }, 400);
    }

    const [prospectResult, demandResult, sourceResult, enrichmentResult, salesResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("business_prospects")
        .select("id,display_name,category,city,status,review_status,duplicate_of_prospect_id,last_verified_at,source_confidence")
        .eq("id", prospectId)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("business_demand_rollups")
        .select("favorites_count,requests_count,views_count,unique_users_count,city,rollup_date")
        .eq("prospect_id", prospectId)
        .gte("rollup_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
      ctx.supabaseAdmin
        .from("business_prospect_sources")
        .select("created_at,stale_at,confidence,provider,source_url")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(1),
      ctx.supabaseAdmin
        .from("business_prospect_enrichments")
        .select("review_status,confidence,created_at,enrichment_json")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(1),
      ctx.supabaseAdmin
        .from("sales_accounts")
        .select("stage,priority,last_contact_at,outcome")
        .eq("prospect_id", prospectId)
        .maybeSingle(),
    ]);

    if (prospectResult.error) throw prospectResult.error;
    if (demandResult.error) throw demandResult.error;
    if (sourceResult.error) throw sourceResult.error;
    if (enrichmentResult.error) throw enrichmentResult.error;
    if (salesResult.error) throw salesResult.error;
    const prospect = prospectResult.data as Record<string, unknown> | null;
    if (!prospect) return json(req, { error: "Prospect not found.", request_id: requestId }, 404);

    const demandRows = (demandResult.data ?? []) as Array<Record<string, unknown>>;
    const demand = demandRows.reduce<DemandAggregate>((acc, row) => ({
      favorites: acc.favorites + (Number(row.favorites_count) || 0),
      requests: acc.requests + (Number(row.requests_count) || 0),
      views: acc.views + (Number(row.views_count) || 0),
      uniqueUsers: Math.max(acc.uniqueUsers, Number(row.unique_users_count) || 0),
    }), { favorites: 0, requests: 0, views: 0, uniqueUsers: 0 });
    const latestSource = ((sourceResult.data ?? []) as Array<Record<string, unknown>>)[0];
    const latestEnrichment = ((enrichmentResult.data ?? []) as Array<Record<string, unknown>>)[0];
    const fallback = buildDeterministicScore({ prospect, demand, latestSource, latestEnrichment });

    const ai = await generateAdminAiJson({
      ctx,
      feature: "prospect_scoring",
      promptVersion: nullableString(payload.score_version, 60) || ADMIN_AI_PROMPT_VERSIONS.prospect_scoring,
      systemPrompt: adminAiSystemPrompt("prospect_scoring"),
      userPrompt: JSON.stringify({
        prospect,
        demand,
        source: latestSource ?? null,
        enrichment: latestEnrichment ?? null,
        sales_account: salesResult.data ?? null,
        launch_area: payload.launch_area ?? null,
        customer_demand_signals_are_aggregate_only: true,
      }),
      jsonSchema: SCORE_SCHEMA,
      fallbackValue: fallback,
      relatedProspectId: prospectId,
      inputSummary: {
        prospect_id: prospectId,
        demand,
        has_source: Boolean(latestSource),
        has_enrichment: Boolean(latestEnrichment),
      },
      defaultConfidence: fallback.confidence,
      defaultWarnings: fallback.warnings,
      requiresHumanReview: true,
      safeForPublicDisplay: false,
    });

    const totalScore = clampScore(ai.output.total_score);
    const componentDuplicateRisk = Number((ai.output.score_components as Record<string, unknown> | undefined)?.duplicate_risk ?? 0);
    const scoreTier = ["A", "B", "C", "Do Not Contact"].includes(String(ai.output.tier))
      ? String(ai.output.tier)
      : tier(totalScore, componentDuplicateRisk);
    const recommendedNextAction = cleanString(ai.output.recommended_next_action, 300) || fallback.recommended_next_action;
    const scoreInputs = {
      prospect: {
        category: prospect.category,
        city: prospect.city,
        status: prospect.status,
        review_status: prospect.review_status,
      },
      demand,
      source: latestSource ?? null,
      enrichment_review_status: latestEnrichment?.review_status ?? null,
      sales_account: salesResult.data ?? null,
      ai: ai.output,
    };

    const { data: score, error: scoreError } = await ctx.supabaseAdmin
      .from("business_prospect_scores")
      .insert({
        prospect_id: prospectId,
        score_version: ai.promptVersion,
        total_score: totalScore,
        tier: scoreTier,
        score_inputs_json: scoreInputs,
        recommended_next_action: recommendedNextAction,
      })
      .select("id,prospect_id,score_version,total_score,tier,recommended_next_action,created_at")
      .single();
    if (scoreError) throw scoreError;

    await ctx.supabaseAdmin
      .from("sales_accounts")
      .upsert({
        prospect_id: prospectId,
        stage: scoreTier === "Do Not Contact" ? "stale" : totalScore >= 60 ? "ready_to_contact" : "enriched",
        priority: scoreTier === "A" ? "high" : scoreTier === "B" ? "normal" : "low",
        next_action: recommendedNextAction,
      }, { onConflict: "prospect_id" });

    await audit(ctx, {
      action: "admin_prospect_scored",
      targetType: "business_prospect",
      targetId: prospectId,
      afterValue: {
        total_score: totalScore,
        tier: scoreTier,
        recommended_next_action: recommendedNextAction,
        provider: ai.provider,
        model: ai.model,
      },
      reason: nullableString(payload.reason, 500) || "prospect_scoring",
    });

    return json(req, { ok: true, request_id: requestId, score, score_json: ai.output });
  } catch (error) {
    if (String((error as Error)?.message ?? "") === "ADMIN_AI_RATE_LIMITED") {
      return json(req, { error: "Too many admin AI requests in the last hour. Try again later.", request_id: requestId }, 429);
    }
    console.error("[admin-prospect-score] error:", error);
    return json(req, { error: "Failed to score prospect.", request_id: requestId }, 500);
  }
});
