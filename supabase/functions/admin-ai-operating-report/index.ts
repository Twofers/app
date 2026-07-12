import {
  audit,
  cleanString,
  json,
  readPayload,
  requireAdmin,
} from "../_shared/admin-prospects.ts";
import {
  adminAiSystemPrompt,
  ADMIN_AI_PROMPT_VERSIONS,
  generateAdminAiJson,
} from "../_shared/admin-ai.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

async function countRows(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

const OPERATING_REPORT_SCHEMA = {
  name: "admin_operating_report_summary",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      founder_summary: { type: "string" },
      recommended_next_actions: { type: "array", items: { type: "string" } },
      risks_to_watch: { type: "array", items: { type: "string" } },
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
      "founder_summary",
      "recommended_next_actions",
      "risks_to_watch",
      "confidence",
      "sources",
      "warnings",
      "review_status",
      "requires_human_review",
      "safe_for_public_display",
    ],
  },
};

function fallbackOperatingSummary(report: Record<string, unknown>) {
  const prospects = report.prospects as Record<string, unknown>;
  const claimLinks = report.claim_links as Record<string, unknown>;
  const conversions = report.conversions as Record<string, unknown>;
  const actions: string[] = [];
  if (Number(prospects?.needing_review ?? 0) > 0) actions.push("Review AI-enriched prospects that still need human approval.");
  if (Number(prospects?.stale_source_count ?? 0) > 0) actions.push("Refresh stale prospect sources before outreach.");
  if (Number(claimLinks?.expired ?? 0) > 0) actions.push("Follow up on expired claim links and decide whether to resend.");
  if (Number(conversions?.prospect_to_trial ?? 0) === 0) actions.push("Prioritize A-tier prospects and generate demand proof before field visits.");
  return {
    founder_summary: "Admin AI operations are available for prospect enrichment, scoring, demand proof, sales scripts, claim-link support, trial conversion guidance, and reporting.",
    recommended_next_actions: actions.length ? actions : ["Work the sales AI queue and review top A-tier prospects."],
    risks_to_watch: [
      "Provider failures or circuit breaker openings",
      "Prospects with AI facts that have not been reviewed",
      "Demand proof below privacy thresholds",
    ],
    confidence: 0.64,
    sources: [],
    warnings: ["This operating report is internal-only."],
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

  if (req.method !== "POST" && req.method !== "GET") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  const requestId = crypto.randomUUID();

  try {
    const ctx = await requireAdmin(req, requestId, "report.generate");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const requestedStart = cleanString(payload.date_from, 40);
    const requestedEnd = cleanString(payload.date_to, 40);
    const monthStart = /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) ? `${requestedStart}T00:00:00.000Z` : monthStartIso();
    const endExclusive = /^\d{4}-\d{2}-\d{2}$/.test(requestedEnd) ? `${requestedEnd}T23:59:59.999Z` : null;
    const nowIso = new Date().toISOString();

    const [
      enrichmentsThisMonth,
      prospectsNeedingReview,
      staleSources,
      demandProofGenerated,
      salesActivitiesThisMonth,
      claimLinksSent,
      claimLinksAccepted,
      claimLinksExpired,
      prospectTrialConversions,
      trialToActiveBusinesses,
      scoreA,
      scoreB,
      scoreC,
      scoreDoNotContact,
      costByFeature,
      providerFailures,
      circuitBreakers,
      recentAudit,
    ] = await Promise.all([
      countRows(ctx.supabaseAdmin.from("business_prospect_enrichments").select("id", { count: "exact", head: true }).gte("created_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("business_prospects").select("id", { count: "exact", head: true }).eq("review_status", "needs_review")),
      countRows(ctx.supabaseAdmin.from("business_prospect_sources").select("id", { count: "exact", head: true }).lt("stale_at", nowIso)),
      countRows(ctx.supabaseAdmin.from("admin_audit_log").select("id", { count: "exact", head: true }).eq("action", "admin_demand_proof_generated").gte("created_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("sales_activities").select("id", { count: "exact", head: true }).gte("created_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("business_claim_links").select("id", { count: "exact", head: true }).gte("created_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("business_claim_links").select("id", { count: "exact", head: true }).not("accepted_at", "is", null).gte("accepted_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("business_claim_links").select("id", { count: "exact", head: true }).is("accepted_at", null).lt("expires_at", nowIso)),
      countRows(ctx.supabaseAdmin.from("prospect_to_business_links").select("id", { count: "exact", head: true }).eq("conversion_type", "trial_created").gte("created_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("businesses").select("id", { count: "exact", head: true }).eq("status", "active").gte("first_approved_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("business_prospect_scores").select("id", { count: "exact", head: true }).eq("tier", "A").gte("created_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("business_prospect_scores").select("id", { count: "exact", head: true }).eq("tier", "B").gte("created_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("business_prospect_scores").select("id", { count: "exact", head: true }).eq("tier", "C").gte("created_at", monthStart)),
      countRows(ctx.supabaseAdmin.from("business_prospect_scores").select("id", { count: "exact", head: true }).eq("tier", "Do Not Contact").gte("created_at", monthStart)),
      ctx.supabaseAdmin
        .from("ai_generation_cost_by_feature_model")
        .select("feature,model,endpoint,total_ai_cost_usd,call_count,failed_or_retried_calls")
        .order("total_ai_cost_usd", { ascending: false })
        .limit(25),
      ctx.supabaseAdmin
        .from("ai_generation_costs")
        .select("feature,provider,model,error_code,created_at")
        .eq("success", false)
        .gte("created_at", monthStart)
        .order("created_at", { ascending: false })
        .limit(25),
      ctx.supabaseAdmin
        .from("ai_provider_circuit_breakers")
        .select("provider,capability,state,failure_count,last_error_class,disabled_until,updated_at")
        .order("updated_at", { ascending: false })
        .limit(25),
      ctx.supabaseAdmin
        .from("admin_audit_log")
        .select("action,target_type,reason,created_at")
        .in("action", [
          "admin_prospect_imported",
          "admin_prospect_enriched",
          "admin_prospect_scored",
          "admin_demand_proof_generated",
          "admin_claim_link_created",
          "admin_claim_link_revoked",
          "admin_sales_activity_logged",
          "admin_trial_created_from_prospect",
        ])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (costByFeature.error) throw costByFeature.error;
    if (providerFailures.error) throw providerFailures.error;
    if (circuitBreakers.error) throw circuitBreakers.error;
    if (recentAudit.error) throw recentAudit.error;

    const report = {
      generated_at: nowIso,
      month_start: monthStart,
      date_end: endExclusive,
      filters: {
        city: cleanString(payload.city, 80) || null,
        launch_area: cleanString(payload.launch_area, 120) || null,
        feature: cleanString(payload.feature, 80) || null,
        provider: cleanString(payload.provider, 80) || null,
        model: cleanString(payload.model, 120) || null,
        admin_user: cleanString(payload.admin_user, 120) || null,
        prospect_status: cleanString(payload.prospect_status, 80) || null,
        sales_stage: cleanString(payload.sales_stage, 80) || null,
      },
      ai: {
        enrichment_volume: enrichmentsThisMonth,
        cost_by_feature_model: costByFeature.data ?? [],
        provider_failures: providerFailures.data ?? [],
        circuit_breakers: circuitBreakers.data ?? [],
      },
      prospects: {
        score_distribution: { A: scoreA, B: scoreB, C: scoreC, "Do Not Contact": scoreDoNotContact },
        needing_review: prospectsNeedingReview,
        stale_source_count: staleSources,
      },
      demand_and_sales: {
        demand_proof_generated: demandProofGenerated,
        sales_activity_count: salesActivitiesThisMonth,
      },
      claim_links: {
        sent: claimLinksSent,
        accepted: claimLinksAccepted,
        expired: claimLinksExpired,
      },
      conversions: {
        prospect_to_trial: prospectTrialConversions,
        trial_to_active: trialToActiveBusinesses,
      },
      recent_admin_activity: recentAudit.data ?? [],
    } as Record<string, unknown>;

    const summaryAi = await generateAdminAiJson({
      ctx,
      feature: "operating_report",
      promptVersion: ADMIN_AI_PROMPT_VERSIONS.operating_report,
      systemPrompt: adminAiSystemPrompt("operating_report"),
      userPrompt: JSON.stringify({
        report,
        instructions: "Summarize what happened, what cost/failure risks matter, and what Dan should do next. Keep it concise and internal-only.",
      }),
      jsonSchema: OPERATING_REPORT_SCHEMA,
      fallbackValue: fallbackOperatingSummary(report),
      inputSummary: {
        month_start: monthStart,
        date_end: endExclusive,
        feature: cleanString(payload.feature, 80) || null,
      },
      defaultConfidence: 0.64,
      requiresHumanReview: true,
      safeForPublicDisplay: false,
    });

    Object.assign(report, {
      founder_summary: summaryAi.output.founder_summary,
      recommended_next_actions: summaryAi.output.recommended_next_actions,
      risks_to_watch: summaryAi.output.risks_to_watch,
      ai_summary: summaryAi.output,
    });

    await audit(ctx, {
      action: "admin_ai_operating_report_viewed",
      targetType: "admin_dashboard",
      afterValue: {
        month_start: monthStart,
        enrichment_volume: enrichmentsThisMonth,
        prospects_needing_review: prospectsNeedingReview,
        summary_provider: summaryAi.provider,
        summary_model: summaryAi.model,
      },
      reason: "ai_operating_report",
    });

    return json(req, { ok: true, request_id: requestId, report });
  } catch (error) {
    if (String((error as Error)?.message ?? "") === "ADMIN_AI_RATE_LIMITED") {
      return json(req, { error: "Too many admin AI requests in the last hour. Try again later.", request_id: requestId }, 429);
    }
    console.error("[admin-ai-operating-report] error:", error);
    return json(req, { error: "Failed to load operating report.", request_id: requestId }, 500);
  }
});
