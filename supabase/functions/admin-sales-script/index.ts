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

const SALES_SCRIPT_SCHEMA = {
  name: "admin_sales_script",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      in_person_30_second_pitch: { type: "string" },
      demo_pitch: { type: "string" },
      follow_up_email: { type: "string" },
      follow_up_sms: { type: "string" },
      objection_responses: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            objection: { type: "string" },
            response: { type: "string" },
          },
          required: ["objection", "response"],
        },
      },
      suggested_first_offer: { type: "string" },
      suggested_next_action: { type: "string" },
      tone: { type: "string" },
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
      "in_person_30_second_pitch",
      "demo_pitch",
      "follow_up_email",
      "follow_up_sms",
      "objection_responses",
      "suggested_first_offer",
      "suggested_next_action",
      "tone",
      "confidence",
      "sources",
      "warnings",
      "review_status",
      "requires_human_review",
      "safe_for_public_display",
    ],
  },
};

const SUPPORTED_OBJECTIONS = [
  "I do not want discount customers",
  "We are too busy",
  "We already use Instagram",
  "We already have loyalty software",
  "I do not want another app",
  "My staff will not use it",
  "I do not have time",
  "Is this like Groupon",
  "What happens after the free trial",
  "How much does it cost",
];

function preferredWindow(category: unknown): string {
  const text = String(category ?? "").toLowerCase();
  if (/(coffee|cafe|bakery)/.test(text)) return "weekday lunch or mid-afternoon";
  if (/restaurant/.test(text)) return "weekday lunch, early dinner, or another slower window you control";
  return "a limited window you choose";
}

function demandLine(aggregate: { demand: number; uniqueUsers: number }): string {
  return aggregate.uniqueUsers >= 5
    ? `${aggregate.demand} aggregate local interest signals have come in for this business.`
    : "We are collecting early local demand signals, and I do not want to overstate them before the cohort is larger.";
}

function fallbackScript(input: {
  prospect: Record<string, unknown>;
  aggregate: { demand: number; uniqueUsers: number };
  tone: string;
  stage: string;
}) {
  const name = String(input.prospect.display_name ?? "your business");
  const window = preferredWindow(input.prospect.category);
  const demand = demandLine(input.aggregate);
  const pitch = `Hi, I am with Twofer. We are inviting selected local businesses to test controlled, limited-time local offers during slower windows. ${demand} ${name} is not active on Twofer unless an owner or manager claims and completes setup.`;
  return {
    in_person_30_second_pitch: `${pitch} Would it be okay if I sent a secure claim link for review?`,
    demo_pitch: `${pitch} A first test could run during ${window}. You choose the timing, quantity, and terms before anything goes live.`,
    follow_up_email: [
      `Subject: Twofer founding trial for ${name}`,
      "",
      `Hi ${name} team,`,
      "",
      `Twofer is inviting a small group of local businesses to review a founding trial. ${demand}`,
      `A good first test could be a limited-time local offer during ${window}. Nothing goes live until an owner or manager claims the profile and approves setup.`,
    ].join("\n"),
    follow_up_sms: "Twofer is inviting selected local businesses to review a founding trial. May I send the owner a secure claim link?",
    objection_responses: SUPPORTED_OBJECTIONS.map((objection) => ({
      objection,
      response: "That is fair. Twofer is meant for controlled local offers that you approve, with caps and a clear end time. Nothing goes live without owner review.",
    })),
    suggested_first_offer: `A small limited-time local offer during ${window}.`,
    suggested_next_action: input.stage === "claim_link_sent" ? "Follow up on the claim link" : "Ask for the owner or manager who can review a secure claim link",
    tone: input.tone,
    confidence: input.aggregate.uniqueUsers >= 5 ? 0.7 : 0.55,
    sources: [],
    warnings: ["Do not imply guaranteed revenue or a live offer.", "Keep the script short in the field."],
    review_status: "needs_review",
    requires_human_review: true,
    safe_for_public_display: false,
  };
}

type DemandAggregate = {
  demand: number;
  uniqueUsers: number;
};

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
    const ctx = await requireAdmin(req, requestId, "sales.write");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const prospectId = cleanString(payload.prospect_id, 80);
    if (!UUID_RE.test(prospectId)) {
      return json(req, { error: "Prospect is required.", request_id: requestId }, 400);
    }
    const scriptType = ["call", "visit", "email", "sms", "full"].includes(cleanString(payload.script_type, 20))
      ? cleanString(payload.script_type, 20)
      : "call";
    const tone = ["direct", "friendly", "professional", "founder-led"].includes(cleanString(payload.tone, 40))
      ? cleanString(payload.tone, 40)
      : "founder-led";

    const [prospectResult, rollupResult, salesResult, latestProofResult] = await Promise.all([
      ctx.supabaseAdmin
        .from("business_prospects")
        .select("id,display_name,category,city,status,review_status,public_label_state")
        .eq("id", prospectId)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("business_demand_rollups")
        .select("favorites_count,requests_count,views_count,unique_users_count")
        .eq("prospect_id", prospectId)
        .gte("rollup_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
      ctx.supabaseAdmin
        .from("sales_accounts")
        .select("id,stage,priority,next_action,objections_json,notes")
        .eq("prospect_id", prospectId)
        .maybeSingle(),
      ctx.supabaseAdmin
        .from("admin_audit_log")
        .select("created_at,after_value")
        .eq("target_id", prospectId)
        .eq("action", "admin_demand_proof_generated")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (prospectResult.error) throw prospectResult.error;
    if (rollupResult.error) throw rollupResult.error;
    if (salesResult.error) throw salesResult.error;
    if (latestProofResult.error) throw latestProofResult.error;
    const prospect = prospectResult.data as Record<string, unknown> | null;
    if (!prospect) return json(req, { error: "Prospect not found.", request_id: requestId }, 404);

    const aggregate = ((rollupResult.data ?? []) as Array<Record<string, unknown>>).reduce<DemandAggregate>((acc, row) => ({
      demand: acc.demand + (Number(row.favorites_count) || 0) + (Number(row.requests_count) || 0) + (Number(row.views_count) || 0),
      uniqueUsers: Math.max(acc.uniqueUsers, Number(row.unique_users_count) || 0),
    }), { demand: 0, uniqueUsers: 0 });
    const sales = salesResult.data as Record<string, unknown> | null;
    const fallback = fallbackScript({
      prospect,
      aggregate,
      tone,
      stage: cleanString(sales?.stage, 60) || cleanString(payload.sales_stage, 60) || "cold",
    });

    const ai = await generateAdminAiJson({
      ctx,
      feature: "sales_script",
      operation: "compose_offer",
      promptVersion: ADMIN_AI_PROMPT_VERSIONS.sales_script,
      systemPrompt: adminAiSystemPrompt("sales_script"),
      userPrompt: JSON.stringify({
        script_type: scriptType,
        tone,
        prospect: {
          id: prospect.id,
          display_name: prospect.display_name,
          category: prospect.category,
          city: prospect.city,
          status: prospect.status,
          review_status: prospect.review_status,
          public_label_state: prospect.public_label_state,
        },
        demand_proof_summary: aggregate.uniqueUsers >= 5 ? demandLine(aggregate) : "Below threshold; use broad early-interest language only.",
        sales_stage: sales?.stage ?? payload.sales_stage ?? "cold",
        owner_objection_notes: cleanString(payload.owner_objection_notes ?? sales?.notes, 1200),
        known_objections: Array.isArray(sales?.objections_json) ? sales?.objections_json : SUPPORTED_OBJECTIONS,
        supported_objections: SUPPORTED_OBJECTIONS,
        rules: {
          no_overpromising: true,
          no_guaranteed_revenue: true,
          unclaimed_business_not_partner: true,
          no_live_offer_implication: true,
        },
      }),
      jsonSchema: SALES_SCRIPT_SCHEMA,
      fallbackValue: fallback,
      relatedProspectId: prospectId,
      inputSummary: {
        prospect_id: prospectId,
        script_type: scriptType,
        tone,
        sales_stage: sales?.stage ?? payload.sales_stage ?? "cold",
        demand_threshold_met: aggregate.uniqueUsers >= 5,
        has_recent_demand_proof: Boolean((latestProofResult.data ?? []).length),
      },
      defaultConfidence: fallback.confidence,
      defaultWarnings: fallback.warnings,
      requiresHumanReview: true,
      safeForPublicDisplay: false,
    });

    const { data: account } = sales?.id
      ? { data: { id: sales.id } }
      : await ctx.supabaseAdmin
        .from("sales_accounts")
        .upsert({
          prospect_id: prospectId,
          stage: "ready_to_contact",
          priority: "normal",
          next_action: ai.output.suggested_next_action,
        }, { onConflict: "prospect_id" })
        .select("id")
        .single();
    await ctx.supabaseAdmin.from("sales_activities").insert({
      sales_account_id: account?.id ?? null,
      prospect_id: prospectId,
      activity_type: "script_generated",
      summary: `${scriptType} script generated`,
      outcome: cleanString(ai.output.suggested_next_action, 200),
      created_by_admin_user_id: ctx.user.id,
    });

    await audit(ctx, {
      action: "admin_sales_script_generated",
      targetType: "business_prospect",
      targetId: prospectId,
      afterValue: {
        script_type: scriptType,
        tone,
        threshold_met: aggregate.uniqueUsers >= 5,
        provider: ai.provider,
        model: ai.model,
      },
      reason: cleanString(payload.reason, 500) || "sales_script",
    });

    const script = scriptType === "email"
      ? ai.output.follow_up_email
      : scriptType === "sms"
      ? ai.output.follow_up_sms
      : scriptType === "visit"
      ? ai.output.in_person_30_second_pitch
      : ai.output.in_person_30_second_pitch;

    return json(req, {
      ok: true,
      request_id: requestId,
      script_type: scriptType,
      script,
      script_bundle: ai.output,
    });
  } catch (error) {
    if (String((error as Error)?.message ?? "") === "ADMIN_AI_RATE_LIMITED") {
      return json(req, { error: "Too many admin AI requests in the last hour. Try again later.", request_id: requestId }, 429);
    }
    console.error("[admin-sales-script] error:", error);
    return json(req, { error: "Failed to generate sales script.", request_id: requestId }, 500);
  }
});
