import {
  audit,
  cleanString,
  integerInRange,
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

const CLAIM_LINK_ASSISTANT_SCHEMA = {
  name: "admin_claim_link_assistant",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      claim_link_intro_copy: { type: "string" },
      owner_instructions: { type: "array", items: { type: "string" } },
      owner_needs_to_verify: { type: "array", items: { type: "string" } },
      after_claim_explanation: { type: "string" },
      internal_risk_notes: { type: "array", items: { type: "string" } },
      recommended_expiration_days: { type: "integer" },
      recommended_follow_up_date: { type: "string" },
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
      "claim_link_intro_copy",
      "owner_instructions",
      "owner_needs_to_verify",
      "after_claim_explanation",
      "internal_risk_notes",
      "recommended_expiration_days",
      "recommended_follow_up_date",
      "confidence",
      "sources",
      "warnings",
      "review_status",
      "requires_human_review",
      "safe_for_public_display",
    ],
  },
};

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fallbackAssistant(prospect: Record<string, unknown>, trialType: string) {
  const days = trialType === "full" ? 10 : 14;
  return {
    claim_link_intro_copy: `${prospect.display_name ?? "Your business"} has been invited to review a Twofer founding trial. This does not make the business active on Twofer until an owner or manager verifies details and completes setup.`,
    owner_instructions: [
      "Open the secure claim link.",
      "Sign in with the owner or manager email.",
      "Review the business facts and complete setup before anything goes live.",
    ],
    owner_needs_to_verify: [
      "Business name and public location",
      "Owner or manager authority",
      "Slow hours and first local offer idea",
      "Staff instructions before launch",
    ],
    after_claim_explanation: "After claim, an admin can review setup and decide whether to create a limited or full trial. AI does not create the trial or any live offer.",
    internal_risk_notes: [
      "Raw claim token must be shown once to the admin and never logged.",
      "Do not imply the business is a partner before claim and approval.",
    ],
    recommended_expiration_days: days,
    recommended_follow_up_date: daysFromNow(Math.min(7, days)),
    confidence: 0.66,
    sources: [],
    warnings: ["AI drafts copy only. A separate admin click must create or revoke the claim link."],
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
    const ctx = await requireAdmin(req, requestId, "claim_link.write");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const prospectId = cleanString(payload.prospect_id, 80);
    if (!UUID_RE.test(prospectId)) {
      return json(req, { error: "Prospect is required.", request_id: requestId }, 400);
    }

    const [prospectResult, enrichmentResult, demandAuditResult, salesResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("business_prospects")
        .select("id,display_name,category,city,state,postal_code,status,review_status,public_label_state,linked_business_id")
        .eq("id", prospectId)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("business_prospect_enrichments")
        .select("enrichment_json,review_status,confidence,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(1),
      ctx.supabaseAdmin
        .from("admin_audit_log")
        .select("created_at,after_value")
        .eq("target_id", prospectId)
        .eq("action", "admin_demand_proof_generated")
        .order("created_at", { ascending: false })
        .limit(1),
      ctx.supabaseAdmin
        .from("sales_accounts")
        .select("stage,next_action,notes")
        .eq("prospect_id", prospectId)
        .maybeSingle(),
    ]);
    if (prospectResult.error) throw prospectResult.error;
    if (enrichmentResult.error) throw enrichmentResult.error;
    if (demandAuditResult.error) throw demandAuditResult.error;
    if (salesResult.error) throw salesResult.error;
    const prospect = prospectResult.data as Record<string, unknown> | null;
    if (!prospect) return json(req, { error: "Prospect not found.", request_id: requestId }, 404);

    const trialType = ["limited", "full"].includes(cleanString(payload.trial_type, 20))
      ? cleanString(payload.trial_type, 20)
      : "limited";
    const fallback = fallbackAssistant(prospect, trialType);
    const ai = await generateAdminAiJson({
      ctx,
      feature: "claim_link_assistant",
      promptVersion: ADMIN_AI_PROMPT_VERSIONS.claim_link_assistant,
      systemPrompt: adminAiSystemPrompt("claim_link_assistant"),
      userPrompt: JSON.stringify({
        prospect: {
          id: prospect.id,
          display_name: prospect.display_name,
          category: prospect.category,
          city: prospect.city,
          state: prospect.state,
          postal_code: prospect.postal_code,
          status: prospect.status,
          review_status: prospect.review_status,
          public_label_state: prospect.public_label_state,
          linked_business_id: prospect.linked_business_id,
        },
        approved_public_facts: payload.approved_public_facts ?? null,
        latest_enrichment: (enrichmentResult.data ?? [])[0] ?? null,
        latest_demand_proof_audit: (demandAuditResult.data ?? [])[0] ?? null,
        trial_type: trialType,
        admin_notes: cleanString(payload.admin_notes ?? salesResult.data?.notes, 1200),
        requested_expiration_days: integerInRange(payload.expires_in_days, fallback.recommended_expiration_days, 1, 90),
        rules: {
          ai_must_not_create_token: true,
          raw_tokens_never_logged: true,
          token_hash_only_in_database: true,
          admin_must_click_create_or_revoke: true,
        },
      }),
      jsonSchema: CLAIM_LINK_ASSISTANT_SCHEMA,
      fallbackValue: fallback,
      relatedProspectId: prospectId,
      relatedBusinessId: typeof prospect.linked_business_id === "string" ? prospect.linked_business_id : null,
      inputSummary: {
        prospect_id: prospectId,
        trial_type: trialType,
        has_enrichment: Boolean((enrichmentResult.data ?? []).length),
        has_demand_proof: Boolean((demandAuditResult.data ?? []).length),
      },
      defaultConfidence: fallback.confidence,
      defaultWarnings: fallback.warnings,
      requiresHumanReview: true,
      safeForPublicDisplay: false,
    });

    await audit(ctx, {
      action: "admin_claim_link_ai_assistant_generated",
      targetType: "business_prospect",
      targetId: prospectId,
      businessId: typeof prospect.linked_business_id === "string" ? prospect.linked_business_id : null,
      afterValue: {
        recommended_expiration_days: ai.output.recommended_expiration_days,
        provider: ai.provider,
        model: ai.model,
        created_token: false,
      },
      reason: cleanString(payload.reason, 500) || "claim_link_assistant",
    });

    return json(req, { ok: true, request_id: requestId, assistant: ai.output });
  } catch (error) {
    if (String((error as Error)?.message ?? "") === "ADMIN_AI_RATE_LIMITED") {
      return json(req, { error: "Too many admin AI requests in the last hour. Try again later.", request_id: requestId }, 429);
    }
    console.error("[admin-claim-link-assistant] error:", error);
    return json(req, { error: "Failed to generate claim-link guidance.", request_id: requestId }, 500);
  }
});
