import {
  audit,
  cleanString,
  json,
  readPayload,
  requireAdmin,
} from "../_shared/admin-prospects.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

// Records a non-destructive reset marker for the "AI Cost by Feature" report.
// After this runs, ai_generation_cost_by_feature_model only sums spend logged
// after the new reset_at. No cost rows are deleted.
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
    const reason = cleanString(payload.reason, 200) || "Manual reset of the AI Cost by Feature ledger.";
    const resetAt = new Date().toISOString();

    const { data, error } = await ctx.supabaseAdmin
      .from("ai_generation_cost_ledger_resets")
      .insert({
        reset_at: resetAt,
        reset_by_id: ctx.user.id,
        reset_by_email: ctx.adminUser.email ?? ctx.user.email ?? null,
        reason,
      })
      .select("id,reset_at")
      .single();

    if (error) throw error;

    await audit(ctx, {
      action: "admin_ai_cost_ledger_reset",
      targetType: "ai_cost_ledger",
      targetId: data?.id ?? null,
      afterValue: { reset_at: data?.reset_at ?? resetAt },
      reason,
    });

    return json(req, { ok: true, request_id: requestId, reset_at: data?.reset_at ?? resetAt });
  } catch (error) {
    console.error("[admin-ai-cost-ledger-reset] error:", error);
    return json(req, { error: "Failed to reset the AI cost ledger.", request_id: requestId }, 500);
  }
});
