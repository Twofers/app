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

const TRIAL_CONVERSION_SCHEMA = {
  name: "admin_trial_conversion_assistant",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      recommended_trial_type: { type: "string" },
      setup_checklist: { type: "array", items: { type: "string" } },
      missing_information: { type: "array", items: { type: "string" } },
      suggested_first_three_offer_ideas: { type: "array", items: { type: "string" } },
      suggested_first_slow_hour_window: { type: "string" },
      suggested_owner_onboarding_email: { type: "string" },
      suggested_staff_instruction_card: { type: "string" },
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
      "recommended_trial_type",
      "setup_checklist",
      "missing_information",
      "suggested_first_three_offer_ideas",
      "suggested_first_slow_hour_window",
      "suggested_owner_onboarding_email",
      "suggested_staff_instruction_card",
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

function slowWindow(category: unknown): string {
  const text = String(category ?? "").toLowerCase();
  if (/(coffee|cafe|bakery)/.test(text)) return "weekday lunch or mid-afternoon";
  if (/restaurant/.test(text)) return "weekday lunch or early dinner";
  return "the first owner-confirmed slow-hour window";
}

function fallbackConversion(prospect: Record<string, unknown>, application: Record<string, unknown> | null) {
  const missing = [
    ["owner email", application?.email],
    ["phone", application?.phone],
    ["slow hours", application?.slow_hours],
    ["offer interests", application?.offer_interests],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([label]) => String(label));
  const window = slowWindow(prospect.category ?? application?.business_type);
  return {
    recommended_trial_type: missing.length > 2 ? "setup approval after missing info is collected" : "setup approval",
    setup_checklist: [
      "Confirm owner or manager authority",
      "Confirm public business facts",
      "Confirm first slow-hour window",
      "Confirm staff can recognize the redemption flow",
      "Create setup approval only after admin review",
    ],
    missing_information: missing,
    suggested_first_three_offer_ideas: [
      `Limited-time local offer during ${window}`,
      "Bonus item offer with a small quantity cap",
      "Paired offer for a slower daypart",
    ],
    suggested_first_slow_hour_window: window,
    suggested_owner_onboarding_email: "Your Twofer setup is ready for review. Please verify your business facts and first offer preferences before anything goes live.",
    suggested_staff_instruction_card: "Check the customer's active Twofer wallet pass or QR fallback, then mark the redemption complete using the business tools.",
    risk_notes: ["AI recommends setup only. Admin must explicitly approve access. No Stripe action, trial, or live offer is created here."],
    confidence: missing.length ? 0.55 : 0.7,
    sources: [],
    warnings: ["No trial, Stripe customer, subscription, or live offer was created."],
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
    const ctx = await requireAdmin(req, requestId, "trial.create");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const prospectId = cleanString(payload.prospect_id, 80);
    if (!UUID_RE.test(prospectId)) {
      return json(req, { error: "Prospect is required.", request_id: requestId }, 400);
    }

    const [prospectResult, claimLinksResult, conversionResult, salesResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("business_prospects")
        .select("id,display_name,category,address_line1,city,state,postal_code,review_status,status,linked_business_id")
        .eq("id", prospectId)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("business_claim_links")
        .select("id,expires_at,uses_count,accepted_at,revoked_at,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(10),
      ctx.supabaseAdmin
        .from("prospect_to_business_links")
        .select("business_application_id,business_onboarding_request_id,business_id,conversion_type,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(10),
      ctx.supabaseAdmin
        .from("sales_accounts")
        .select("stage,priority,next_action,notes,objections_json")
        .eq("prospect_id", prospectId)
        .maybeSingle(),
    ]);
    if (prospectResult.error) throw prospectResult.error;
    if (claimLinksResult.error) throw claimLinksResult.error;
    if (conversionResult.error) throw conversionResult.error;
    if (salesResult.error) throw salesResult.error;
    const prospect = prospectResult.data as Record<string, unknown> | null;
    if (!prospect) return json(req, { error: "Prospect not found.", request_id: requestId }, 404);

    let application: Record<string, unknown> | null = null;
    const linkedApplicationId = cleanString(((conversionResult.data ?? [])[0] as Record<string, unknown> | undefined)?.business_application_id, 80);
    if (UUID_RE.test(linkedApplicationId)) {
      const { data, error } = await ctx.supabaseAdmin
        .from("business_applications")
        .select("*")
        .eq("id", linkedApplicationId)
        .maybeSingle();
      if (error) throw error;
      application = data as Record<string, unknown> | null;
    }
    let onboardingRequest: Record<string, unknown> | null = null;
    const linkedRequestId = cleanString(application?.onboarding_request_id ?? ((conversionResult.data ?? [])[0] as Record<string, unknown> | undefined)?.business_onboarding_request_id, 80);
    if (UUID_RE.test(linkedRequestId)) {
      const { data, error } = await ctx.supabaseAdmin
        .from("business_onboarding_requests")
        .select("*")
        .eq("id", linkedRequestId)
        .maybeSingle();
      if (error) throw error;
      onboardingRequest = data as Record<string, unknown> | null;
    }

    let billingStatus: Record<string, unknown> | null = null;
    const linkedBusinessId = cleanString(prospect.linked_business_id, 80);
    if (UUID_RE.test(linkedBusinessId)) {
      const { data, error } = await ctx.supabaseAdmin
        .from("business_subscriptions")
        .select("billing_status,app_access_status,trial_start,trial_end,current_period_end,updated_at")
        .eq("business_id", linkedBusinessId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      billingStatus = data as Record<string, unknown> | null;
    }

    const fallback = fallbackConversion(prospect, application);
    const ai = await generateAdminAiJson({
      ctx,
      feature: "trial_conversion_assistant",
      promptVersion: ADMIN_AI_PROMPT_VERSIONS.trial_conversion_assistant,
      systemPrompt: adminAiSystemPrompt("trial_conversion_assistant"),
      userPrompt: JSON.stringify({
        prospect,
        claim_history: claimLinksResult.data ?? [],
        business_application: application,
        onboarding_request: onboardingRequest,
        billing_status: billingStatus,
        trial_limits: {
          limited: { trial_days: 90, offer_limit: 1, claim_limit: 25 },
          full: { trial_days: 90, offer_limit: 3, claim_limit: 50 },
        },
        sales_notes: salesResult.data ?? null,
        rules: {
          recommendation_only: true,
          admin_must_create_trial: true,
          no_stripe_action: true,
          no_live_offer_creation: true,
        },
      }),
      jsonSchema: TRIAL_CONVERSION_SCHEMA,
      fallbackValue: fallback,
      relatedProspectId: prospectId,
      relatedBusinessId: UUID_RE.test(linkedBusinessId) ? linkedBusinessId : null,
      inputSummary: {
        prospect_id: prospectId,
        linked_business_id: UUID_RE.test(linkedBusinessId) ? linkedBusinessId : null,
        claim_link_count: (claimLinksResult.data ?? []).length,
        has_application: Boolean(application),
        has_onboarding_request: Boolean(onboardingRequest),
        has_billing_status: Boolean(billingStatus),
      },
      defaultConfidence: fallback.confidence,
      defaultWarnings: fallback.warnings,
      requiresHumanReview: true,
      safeForPublicDisplay: false,
    });

    await audit(ctx, {
      action: "admin_trial_conversion_ai_assistant_generated",
      targetType: "business_prospect",
      targetId: prospectId,
      businessId: UUID_RE.test(linkedBusinessId) ? linkedBusinessId : null,
      afterValue: {
        recommended_trial_type: ai.output.recommended_trial_type,
        provider: ai.provider,
        model: ai.model,
        created_trial: false,
        stripe_action: false,
        created_offer: false,
      },
      reason: cleanString(payload.reason, 500) || "trial_conversion_assistant",
    });

    return json(req, { ok: true, request_id: requestId, assistant: ai.output });
  } catch (error) {
    if (String((error as Error)?.message ?? "") === "ADMIN_AI_RATE_LIMITED") {
      return json(req, { error: "Too many admin AI requests in the last hour. Try again later.", request_id: requestId }, 429);
    }
    console.error("[admin-trial-conversion-assistant] error:", error);
    return json(req, { error: "Failed to generate trial conversion guidance.", request_id: requestId }, 500);
  }
});
