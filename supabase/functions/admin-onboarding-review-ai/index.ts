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

const ONBOARDING_REVIEW_SCHEMA = {
  name: "admin_onboarding_review",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      application_summary: { type: "string" },
      missing_fields: { type: "array", items: { type: "string" } },
      possible_duplicate_business: { type: "string" },
      risk_flags: { type: "array", items: { type: "string" } },
      recommended_approval_path: { type: "string" },
      suggested_admin_note: { type: "string" },
      suggested_next_email: { type: "string" },
      suggested_follow_up: { type: "string" },
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
      "application_summary",
      "missing_fields",
      "possible_duplicate_business",
      "risk_flags",
      "recommended_approval_path",
      "suggested_admin_note",
      "suggested_next_email",
      "suggested_follow_up",
      "confidence",
      "sources",
      "warnings",
      "review_status",
      "requires_human_review",
      "safe_for_public_display",
    ],
  },
};

function fallbackReview(application: Record<string, unknown>, onboardingRequest: Record<string, unknown> | null) {
  const missing = [
    ["contact name", application.contact_name],
    ["owner email", application.email],
    ["business type", application.business_type],
    ["address", application.address],
    ["slow hours", application.slow_hours],
    ["offer interests", application.offer_interests],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([label]) => String(label));
  const riskScore = Number(application.risk_score);
  const recommended = Number.isFinite(riskScore) && riskScore < 40
    ? "needs manual review"
    : missing.length > 2
    ? "needs manual review"
    : "approve limited trial";
  return {
    application_summary: `${application.business_name ?? "This business"} requested website onboarding in ${application.launch_area ?? "an unspecified launch area"}.`,
    missing_fields: missing,
    possible_duplicate_business: onboardingRequest?.business_id ? "Existing linked business record found." : "No duplicate confirmed from supplied records.",
    risk_flags: Number.isFinite(riskScore) && riskScore < 40 ? ["Low deterministic risk score"] : [],
    recommended_approval_path: recommended,
    suggested_admin_note: `AI recommends ${recommended}. Admin must make the final decision.`,
    suggested_next_email: "Thanks for your interest in Twofer. We are reviewing your request and will follow up with next steps.",
    suggested_follow_up: missing.length ? `Ask for: ${missing.join(", ")}.` : "Review for limited trial approval.",
    confidence: missing.length ? 0.55 : 0.68,
    sources: [],
    warnings: [
      "Recommendation only. AI must not approve, reject, waitlist, bill, or create a business.",
      "Final admin decision must be audited separately.",
    ],
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
    const ctx = await requireAdmin(req, requestId, "report.generate");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const applicationId = cleanString(payload.application_id, 80);
    const onboardingRequestId = cleanString(payload.onboarding_request_id, 80);
    if (!UUID_RE.test(applicationId) && !UUID_RE.test(onboardingRequestId)) {
      return json(req, { error: "Application or onboarding request is required.", request_id: requestId }, 400);
    }

    const applicationQuery = ctx.supabaseAdmin
      .from("business_applications")
      .select("*")
      .limit(1);
    const applicationResult = UUID_RE.test(applicationId)
      ? await applicationQuery.eq("id", applicationId).maybeSingle()
      : await applicationQuery.eq("onboarding_request_id", onboardingRequestId).maybeSingle();
    if (applicationResult.error) throw applicationResult.error;
    const application = applicationResult.data as Record<string, unknown> | null;
    if (!application) return json(req, { error: "Application not found.", request_id: requestId }, 404);

    let onboardingRequest: Record<string, unknown> | null = null;
    const linkedRequestId = cleanString(application.onboarding_request_id ?? onboardingRequestId, 80);
    if (UUID_RE.test(linkedRequestId)) {
      const { data, error } = await ctx.supabaseAdmin
        .from("business_onboarding_requests")
        .select("*")
        .eq("id", linkedRequestId)
        .maybeSingle();
      if (error) throw error;
      onboardingRequest = data as Record<string, unknown> | null;
    }

    const duplicateCandidates = await ctx.supabaseAdmin
      .from("businesses")
      .select("id,name,status,city,postal_code")
      .ilike("name", `%${cleanString(application.business_name, 120)}%`)
      .limit(5);
    if (duplicateCandidates.error) throw duplicateCandidates.error;

    const fallback = fallbackReview(application, onboardingRequest);
    const ai = await generateAdminAiJson({
      ctx,
      feature: "onboarding_review",
      promptVersion: ADMIN_AI_PROMPT_VERSIONS.onboarding_review,
      systemPrompt: adminAiSystemPrompt("onboarding_review"),
      userPrompt: JSON.stringify({
        business_application: {
          id: application.id,
          business_name: application.business_name,
          contact_name: application.contact_name,
          email_present: Boolean(application.email),
          phone_present: Boolean(application.phone),
          address_present: Boolean(application.address),
          business_type: application.business_type,
          launch_area: application.launch_area,
          status: application.status,
          risk_score: application.risk_score,
          risk_reasons: application.risk_reasons,
          slow_hours: application.slow_hours,
          offer_interests: application.offer_interests,
          website_or_instagram: application.website_or_instagram,
        },
        onboarding_request: onboardingRequest,
        duplicate_candidates: duplicateCandidates.data ?? [],
        rules: {
          recommendation_only: true,
          admin_click_required_for_decisions: true,
          no_billing_or_business_creation: true,
        },
      }),
      jsonSchema: ONBOARDING_REVIEW_SCHEMA,
      fallbackValue: fallback,
      relatedBusinessId: typeof application.business_id === "string" ? application.business_id : null,
      inputSummary: {
        application_id: application.id,
        onboarding_request_id: linkedRequestId || null,
        duplicate_candidate_count: (duplicateCandidates.data ?? []).length,
      },
      defaultConfidence: fallback.confidence,
      defaultWarnings: fallback.warnings,
      requiresHumanReview: true,
      safeForPublicDisplay: false,
    });

    await audit(ctx, {
      action: "admin_onboarding_review_ai_generated",
      targetType: "business_application",
      targetId: String(application.id),
      businessId: typeof application.business_id === "string" ? application.business_id : null,
      afterValue: {
        recommended_approval_path: ai.output.recommended_approval_path,
        provider: ai.provider,
        model: ai.model,
      },
      reason: cleanString(payload.reason, 500) || "onboarding_review_ai",
    });

    return json(req, { ok: true, request_id: requestId, recommendation: ai.output });
  } catch (error) {
    if (String((error as Error)?.message ?? "") === "ADMIN_AI_RATE_LIMITED") {
      return json(req, { error: "Too many admin AI requests in the last hour. Try again later.", request_id: requestId }, 429);
    }
    console.error("[admin-onboarding-review-ai] error:", error);
    return json(req, { error: "Failed to generate onboarding review.", request_id: requestId }, 500);
  }
});
