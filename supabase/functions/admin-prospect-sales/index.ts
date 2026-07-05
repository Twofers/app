import {
  audit,
  cleanString,
  json,
  nullableString,
  readPayload,
  requireAdmin,
  UUID_RE,
} from "../_shared/admin-prospects.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const STAGES = new Set([
  "new",
  "enriched",
  "ready_to_contact",
  "contacted",
  "demo_scheduled",
  "claim_link_sent",
  "claimed",
  "trial_created",
  "active",
  "not_interested",
  "duplicate",
  "stale",
]);

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const ACTIVITY_TYPES = new Set(["call", "visit", "email", "note", "script_generated", "claim_link_sent", "trial_created"]);

async function ensureSalesAccount(ctx: any, prospectId: string) {
  const { data: existing, error: existingError } = await ctx.supabaseAdmin
    .from("sales_accounts")
    .select("id")
    .eq("prospect_id", prospectId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id as string;

  const { data, error } = await ctx.supabaseAdmin
    .from("sales_accounts")
    .insert({ prospect_id: prospectId, stage: "new", priority: "normal" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
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
    const ctx = await requireAdmin(req, requestId, "sales.write");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const action = cleanString(payload.action, 40) || "update_account";
    const prospectId = cleanString(payload.prospect_id, 80);
    if (!UUID_RE.test(prospectId)) {
      return json(req, { error: "Prospect is required.", request_id: requestId }, 400);
    }

    const { data: prospect, error: prospectError } = await ctx.supabaseAdmin
      .from("business_prospects")
      .select("id,status,review_status,linked_business_id")
      .eq("id", prospectId)
      .maybeSingle();
    if (prospectError) throw prospectError;
    if (!prospect) return json(req, { error: "Prospect not found.", request_id: requestId }, 404);

    const accountId = await ensureSalesAccount(ctx, prospectId);

    if (action === "log_activity") {
      const activityType = cleanString(payload.activity_type, 40);
      if (!ACTIVITY_TYPES.has(activityType)) {
        return json(req, { error: "Unsupported activity type.", request_id: requestId }, 400);
      }
      const { data: activity, error: activityError } = await ctx.supabaseAdmin
        .from("sales_activities")
        .insert({
          sales_account_id: accountId,
          prospect_id: prospectId,
          activity_type: activityType,
          summary: nullableString(payload.summary, 1000),
          outcome: nullableString(payload.outcome, 200),
          created_by_admin_user_id: ctx.user.id,
        })
        .select("id,activity_type,summary,outcome,created_at")
        .single();
      if (activityError) throw activityError;

      if (["call", "visit", "email"].includes(activityType)) {
        await ctx.supabaseAdmin
          .from("sales_accounts")
          .update({
            stage: "contacted",
            last_contact_at: new Date().toISOString(),
            outcome: nullableString(payload.outcome, 200),
          })
          .eq("id", accountId);
      }

      await audit(ctx, {
        action: "admin_sales_activity_logged",
        targetType: "business_prospect",
        targetId: prospectId,
        afterValue: activity,
        reason: nullableString(payload.reason, 500) || activityType,
      });

      return json(req, { ok: true, request_id: requestId, activity });
    }

    if (action === "mark_duplicate") {
      const duplicateOfProspectId = cleanString(payload.duplicate_of_prospect_id, 80);
      if (!UUID_RE.test(duplicateOfProspectId) || duplicateOfProspectId === prospectId) {
        return json(req, { error: "Canonical prospect is required.", request_id: requestId }, 400);
      }
      await ctx.supabaseAdmin
        .from("business_prospects")
        .update({ status: "duplicate", review_status: "duplicate", duplicate_of_prospect_id: duplicateOfProspectId })
        .eq("id", prospectId);
      await ctx.supabaseAdmin
        .from("sales_accounts")
        .update({ stage: "duplicate", outcome: "duplicate" })
        .eq("id", accountId);
      await audit(ctx, {
        action: "admin_prospect_marked_duplicate",
        targetType: "business_prospect",
        targetId: prospectId,
        afterValue: { duplicate_of_prospect_id: duplicateOfProspectId },
        reason: nullableString(payload.reason, 500) || "duplicate",
      });
      return json(req, { ok: true, request_id: requestId });
    }

    if (action === "link_business") {
      const businessId = cleanString(payload.business_id, 80);
      if (!UUID_RE.test(businessId)) {
        return json(req, { error: "Business is required.", request_id: requestId }, 400);
      }
      await ctx.supabaseAdmin
        .from("business_prospects")
        .update({ linked_business_id: businessId, public_label_state: "on_twofer", status: "claimed" })
        .eq("id", prospectId);
      await ctx.supabaseAdmin.from("prospect_to_business_links").insert({
        prospect_id: prospectId,
        business_id: businessId,
        conversion_type: "business_linked",
        created_by_admin_user_id: ctx.user.id,
      });
      await ctx.supabaseAdmin
        .from("sales_accounts")
        .update({ business_id: businessId, stage: "claimed" })
        .eq("id", accountId);
      await audit(ctx, {
        action: "admin_prospect_linked_business",
        targetType: "business_prospect",
        targetId: prospectId,
        businessId,
        reason: nullableString(payload.reason, 500) || "business_linked",
      });
      return json(req, { ok: true, request_id: requestId });
    }

    const stage = cleanString(payload.stage, 40);
    const priority = cleanString(payload.priority, 40);
    const patch: Record<string, unknown> = {};
    if (STAGES.has(stage)) patch.stage = stage;
    if (PRIORITIES.has(priority)) patch.priority = priority;
    if ("assigned_admin_user_id" in payload) {
      const assigned = cleanString(payload.assigned_admin_user_id, 80);
      patch.assigned_admin_user_id = UUID_RE.test(assigned) ? assigned : null;
    }
    if ("next_action" in payload) patch.next_action = nullableString(payload.next_action, 300);
    if ("next_action_at" in payload) patch.next_action_at = nullableString(payload.next_action_at, 80);
    if ("outcome" in payload) patch.outcome = nullableString(payload.outcome, 200);
    if ("notes" in payload) patch.notes = nullableString(payload.notes, 4000);
    if ("objections_json" in payload && typeof payload.objections_json === "object") patch.objections_json = payload.objections_json;
    if (!Object.keys(patch).length) {
      return json(req, { error: "No sales fields were provided.", request_id: requestId }, 400);
    }

    const { data: account, error: updateError } = await ctx.supabaseAdmin
      .from("sales_accounts")
      .update(patch)
      .eq("id", accountId)
      .select("id,prospect_id,assigned_admin_user_id,stage,priority,next_action,next_action_at,last_contact_at,outcome,notes,updated_at")
      .single();
    if (updateError) throw updateError;

    if (patch.stage && patch.stage !== "new") {
      await ctx.supabaseAdmin.from("business_prospects").update({ status: patch.stage }).eq("id", prospectId);
    }

    await audit(ctx, {
      action: "admin_sales_account_updated",
      targetType: "business_prospect",
      targetId: prospectId,
      afterValue: patch,
      reason: nullableString(payload.reason, 500) || "sales_update",
    });

    return json(req, { ok: true, request_id: requestId, account });
  } catch (error) {
    console.error("[admin-prospect-sales] error:", error);
    return json(req, { error: "Failed to save sales activity.", request_id: requestId }, 500);
  }
});
