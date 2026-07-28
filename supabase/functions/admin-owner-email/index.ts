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
  generateAdminAiJson,
} from "../_shared/admin-ai.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const REASON_CATEGORIES = new Set([
  "setup_help",
  "email_verification",
  "billing_setup",
  "offer_help",
  "redemption_help",
  "trial_ending",
  "account_support",
]);
const WRITE_ROLES = new Set(["owner", "admin", "support", "sales"]);

function cleanBody(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n").slice(0, 5000) : "";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}

function deterministicDraft(facts: Record<string, unknown>, reason: string) {
  const business = String(facts.business_name || "your business");
  const owner = String(facts.owner_name || "there");
  const next = String(facts.recommended_next_step || "reply to this email and we’ll help with the next step");
  const subjects: Record<string, string> = {
    setup_help: `A quick next step for ${business}`,
    email_verification: `Finish verifying your Twofer email`,
    billing_setup: `Complete billing setup for ${business}`,
    offer_help: `Help publishing your first Twofer offer`,
    redemption_help: `Let’s check the redemption setup for ${business}`,
    trial_ending: `Your Twofer trial needs a next-step review`,
    account_support: `Help with your Twofer account`,
  };
  return {
    subject: subjects[reason] || `Help with ${business} on Twofer`,
    body: `Hi ${owner},\n\nWe noticed there is still a setup step to finish for ${business}. The verified account status suggests this is the most useful next step: ${next}.\n\nIf you would like help, reply to this email and the Twofer team will walk through it with you.\n\n— Twofer Support`,
  };
}

async function verifiedFacts(supabase: any, businessId: string, reason: string) {
  const businessResult = await supabase
    .from("businesses")
    .select("id,owner_id,name,contact_name,status,verification_status")
    .eq("id", businessId)
    .maybeSingle();
  if (businessResult.error) throw businessResult.error;
  if (!businessResult.data) throw Object.assign(new Error("Business not found."), { status: 404 });
  const business = businessResult.data;
  const [ownerResult, dealsResult, subscriptionResult] = await Promise.all([
    business.owner_id
      ? supabase.auth.admin.getUserById(business.owner_id)
      : Promise.resolve({ data: { user: null }, error: null }),
    supabase
      .from("deals")
      .select("id,is_active,start_time,end_time,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("business_subscriptions")
      .select("billing_status,app_access_status,trial_end,stripe_customer_id,updated_at")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (ownerResult.error) throw ownerResult.error;
  if (dealsResult.error) throw dealsResult.error;
  if (subscriptionResult.error) throw subscriptionResult.error;
  const email = ownerResult.data.user?.email?.trim().toLowerCase() || "";
  const now = Date.now();
  const liveOffers = (dealsResult.data ?? []).filter((deal: Record<string, unknown>) => {
    const start = Date.parse(String(deal.start_time || ""));
    const end = Date.parse(String(deal.end_time || ""));
    return deal.is_active === true && start <= now && end > now;
  }).length;
  const nextSteps: Record<string, string> = {
    setup_help: "sign in and complete the remaining business setup fields",
    email_verification: "open the latest verification email and complete the secure verification step",
    billing_setup: "review the secure billing setup link",
    offer_help: liveOffers ? "review the current offer and decide whether another offer is needed" : "create and publish the first offer",
    redemption_help: "confirm that staff can complete a test redemption",
    trial_ending: "review the current trial and billing status",
    account_support: "reply with the account issue so support can verify the next action",
  };
  return {
    business_id: business.id,
    owner_user_id: business.owner_id ?? null,
    owner_email: email,
    owner_name: business.contact_name || null,
    business_name: business.name,
    business_status: business.status,
    verification_status: business.verification_status,
    offer_count: (dealsResult.data ?? []).length,
    live_offer_count: liveOffers,
    app_access_status: subscriptionResult.data?.app_access_status ?? null,
    billing_status: subscriptionResult.data?.billing_status ?? null,
    trial_end: subscriptionResult.data?.trial_end ?? null,
    recommended_next_step: nextSteps[reason],
  };
}

async function generateDraft(ctx: any, facts: Record<string, unknown>, reason: string, refine?: {
  subject: string;
  body: string;
  instruction: string;
}) {
  const fallback = deterministicDraft(facts, reason);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["subject", "body"],
    properties: {
      subject: { type: "string", maxLength: 160 },
      body: { type: "string", maxLength: 5000 },
    },
  };
  const prompt = [
    "Verified facts:",
    JSON.stringify(facts),
    `Reason category: ${reason}.`,
    refine ? `Existing reviewed draft: ${JSON.stringify({ subject: refine.subject, body: refine.body })}` : "",
    refine ? `Requested refinement: ${refine.instruction}. Preserve every fact constraint.` : "",
  ].filter(Boolean).join("\n");
  const generated = await generateAdminAiJson({
    ctx,
    feature: "owner_email",
    operation: "merchant_context",
    promptName: "owner_email",
    systemPrompt: `${adminAiSystemPrompt("owner_email")}\nUse only supplied verified facts. Never promise or imply an account change. Return a concise editable email subject and plain-text body.`,
    userPrompt: prompt,
    jsonSchema: schema,
    fallbackValue: fallback,
    relatedBusinessId: String(facts.business_id),
    inputSummary: {
      business_id: facts.business_id,
      reason_category: reason,
      refinement: refine?.instruction || null,
    },
    maxOutputTokens: 850,
    safeForPublicDisplay: true,
    requiresHumanReview: true,
  });
  const subject = cleanString(generated.output.subject, 160) || fallback.subject;
  const body = cleanBody(generated.output.body) || fallback.body;
  return {
    subject,
    body,
    fallback_used: generated.fallbackUsed,
    provider: generated.provider,
    model: generated.model,
    prompt_version: generated.promptVersion,
    requires_human_review: true,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  const requestId = crypto.randomUUID();
  try {
    const ctx = await requireAdmin(req, requestId, "qr.read");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const action = cleanString(payload.action, 40) || "list";

    if (action === "list") {
      let query = ctx.supabaseAdmin
        .from("admin_owner_communications")
        .select("id,business_id,user_id,admin_user_id,reason_category,subject,status,sent_at,created_at,businesses(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      const businessId = cleanString(payload.business_id, 40);
      if (businessId) {
        if (!UUID_RE.test(businessId)) return json(req, { error: "Invalid business id." }, 400);
        query = query.eq("business_id", businessId);
      }
      const result = await query;
      if (result.error) throw result.error;
      return json(req, { ok: true, communications: result.data ?? [] });
    }

    if (!WRITE_ROLES.has(ctx.adminUser.role)) return json(req, { error: "Your admin role cannot contact owners." }, 403);
    const businessId = cleanString(payload.business_id, 40);
    const reason = cleanString(payload.reason_category, 60);
    if (!UUID_RE.test(businessId)) return json(req, { error: "A valid business id is required." }, 400);
    if (!REASON_CATEGORIES.has(reason)) return json(req, { error: "Choose a valid contact reason." }, 400);
    const facts = await verifiedFacts(ctx.supabaseAdmin, businessId, reason);

    if (action === "draft" || action === "refine") {
      const instruction = action === "refine" ? cleanString(payload.instruction, 80) : "";
      const allowedInstructions = new Set(["shorter", "friendlier", "add_support_link", "regenerate"]);
      if (action === "refine" && !allowedInstructions.has(instruction)) {
        return json(req, { error: "Choose a valid refinement." }, 400);
      }
      const draft = await generateDraft(ctx, facts, reason, action === "refine" ? {
        subject: cleanString(payload.subject, 160),
        body: cleanBody(payload.body),
        instruction,
      } : undefined);
      return json(req, { ok: true, business: facts, draft });
    }

    const subject = cleanString(payload.subject, 160);
    const body = cleanBody(payload.body);
    if (subject.length < 3 || body.length < 20) return json(req, { error: "Review the subject and body before saving." }, 400);

    if (action === "save_draft") {
      const inserted = await ctx.supabaseAdmin.from("admin_owner_communications").insert({
        business_id: businessId,
        user_id: facts.owner_user_id,
        admin_user_id: ctx.user.id,
        reason_category: reason,
        subject,
        body,
        status: "draft",
      }).select("id,status,created_at").single();
      if (inserted.error) throw inserted.error;
      await audit(ctx, {
        action: "admin_owner_email_draft_saved",
        targetType: "admin_owner_communication",
        targetId: inserted.data.id,
        businessId,
        reason,
      });
      return json(req, { ok: true, communication: inserted.data });
    }

    if (action === "send") {
      if (payload.reviewed !== true) return json(req, { error: "Review the editable subject and body before sending." }, 400);
      if (!facts.owner_email) return json(req, { error: "This business owner has no deliverable account email." }, 409);
      const apiKey = Deno.env.get("RESEND_API_KEY");
      if (!apiKey) return json(req, { error: "Owner email delivery is not configured." }, 503);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Twofer <support@twoferapp.com>",
          to: [facts.owner_email],
          subject,
          text: body,
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">${escapeHtml(body)}</div>`,
        }),
      });
      if (!response.ok) return json(req, { error: "The owner email could not be delivered." }, 502);
      const inserted = await ctx.supabaseAdmin.from("admin_owner_communications").insert({
        business_id: businessId,
        user_id: facts.owner_user_id,
        admin_user_id: ctx.user.id,
        reason_category: reason,
        subject,
        body,
        status: "sent",
        sent_at: new Date().toISOString(),
      }).select("id,status,sent_at").single();
      if (inserted.error) throw inserted.error;
      await audit(ctx, {
        action: "admin_owner_email_sent",
        targetType: "admin_owner_communication",
        targetId: inserted.data.id,
        businessId,
        afterValue: { reason_category: reason, subject, status: "sent" },
        reason,
      });
      return json(req, { ok: true, communication: inserted.data });
    }

    return json(req, { error: "Unknown owner-email action." }, 400);
  } catch (error) {
    console.error("[admin-owner-email] sanitized failure", {
      error_code: "ADMIN_OWNER_EMAIL_FAILED",
      request_id: requestId,
    });
    const status = Number((error as { status?: unknown }).status);
    return json(req, {
      error: status === 404 ? "Business not found." : "Owner email operation failed.",
      error_code: "ADMIN_OWNER_EMAIL_FAILED",
      request_id: requestId,
    }, status >= 400 && status < 600 ? status : 500);
  }
});
