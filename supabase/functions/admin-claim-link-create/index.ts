import {
  audit,
  cleanString,
  integerInRange,
  json,
  nullableString,
  randomUrlToken,
  readPayload,
  requireAdmin,
  sha256Hex,
  UUID_RE,
} from "../_shared/admin-prospects.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

async function listLinks(ctx: any, req: Request, requestId: string, prospectId: string, businessId: string) {
  let query = ctx.supabaseAdmin
    .from("business_claim_links")
    .select("id,prospect_id,business_id,expires_at,max_uses,uses_count,accepted_by_user_id,accepted_at,revoked_at,created_by_admin_user_id,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  query = prospectId ? query.eq("prospect_id", prospectId) : query.eq("business_id", businessId);
  const { data, error } = await query;
  if (error) throw error;
  return json(req, { ok: true, request_id: requestId, claim_links: data ?? [] });
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
    const action = cleanString(payload.action, 40) || "create";
    const prospectId = cleanString(payload.prospect_id, 80);
    const businessId = cleanString(payload.business_id, 80);

    if (action === "revoke") {
      const linkId = cleanString(payload.claim_link_id, 80);
      if (!UUID_RE.test(linkId)) {
        return json(req, { error: "Claim link is required.", request_id: requestId }, 400);
      }
      const { data: existing, error: existingError } = await ctx.supabaseAdmin
        .from("business_claim_links")
        .select("id,prospect_id,business_id,revoked_at")
        .eq("id", linkId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return json(req, { error: "Claim link not found.", request_id: requestId }, 404);
      const { data: revoked, error: revokeError } = await ctx.supabaseAdmin
        .from("business_claim_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", linkId)
        .select("id,prospect_id,business_id,expires_at,max_uses,uses_count,accepted_at,revoked_at,created_at")
        .single();
      if (revokeError) throw revokeError;
      await audit(ctx, {
        action: "admin_claim_link_revoked",
        targetType: existing.prospect_id ? "business_prospect" : "business",
        targetId: existing.prospect_id ?? existing.business_id,
        businessId: existing.business_id ?? null,
        reason: nullableString(payload.reason, 500) || "claim_link_revoked",
      });
      return json(req, { ok: true, request_id: requestId, claim_link: revoked });
    }

    if ((!UUID_RE.test(prospectId) && !UUID_RE.test(businessId)) || (UUID_RE.test(prospectId) && UUID_RE.test(businessId))) {
      return json(req, { error: "Choose one prospect or business.", request_id: requestId }, 400);
    }

    if (action === "list") {
      return listLinks(ctx, req, requestId, UUID_RE.test(prospectId) ? prospectId : "", UUID_RE.test(businessId) ? businessId : "");
    }

    const rawToken = randomUrlToken(32);
    const tokenHash = await sha256Hex(rawToken);
    const expiresDays = integerInRange(payload.expires_in_days, 14, 1, 90);
    const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
    const maxUses = integerInRange(payload.max_uses, 1, 1, 10);
    const siteUrl = (Deno.env.get("SITE_URL") || "https://www.twoferapp.com").replace(/\/+$/, "");

    const { data: claimLink, error: insertError } = await ctx.supabaseAdmin
      .from("business_claim_links")
      .insert({
        prospect_id: UUID_RE.test(prospectId) ? prospectId : null,
        business_id: UUID_RE.test(businessId) ? businessId : null,
        token_hash: tokenHash,
        expires_at: expiresAt,
        max_uses: maxUses,
        created_by_admin_user_id: ctx.user.id,
      })
      .select("id,prospect_id,business_id,expires_at,max_uses,uses_count,accepted_at,revoked_at,created_at")
      .single();
    if (insertError) throw insertError;

    if (claimLink.prospect_id) {
      await ctx.supabaseAdmin
        .from("business_prospects")
        .update({ status: "claim_link_sent" })
        .eq("id", claimLink.prospect_id);
      await ctx.supabaseAdmin
        .from("sales_accounts")
        .update({ stage: "claim_link_sent", next_action: "Follow up on owner claim link" })
        .eq("prospect_id", claimLink.prospect_id);
      await ctx.supabaseAdmin.from("sales_activities").insert({
        prospect_id: claimLink.prospect_id,
        activity_type: "claim_link_sent",
        summary: "Claim link created",
        created_by_admin_user_id: ctx.user.id,
      });
    }

    await audit(ctx, {
      action: "admin_claim_link_created",
      targetType: claimLink.prospect_id ? "business_prospect" : "business",
      targetId: claimLink.prospect_id ?? claimLink.business_id,
      businessId: claimLink.business_id ?? null,
      afterValue: {
        claim_link_id: claimLink.id,
        expires_at: claimLink.expires_at,
        max_uses: claimLink.max_uses,
      },
      reason: nullableString(payload.reason, 500) || "claim_link_created",
    });

    return json(req, {
      ok: true,
      request_id: requestId,
      claim_link: claimLink,
      raw_token: rawToken,
      claim_url: `${siteUrl}/business/claim/${rawToken}`,
    });
  } catch (error) {
    console.error("[admin-claim-link-create] error:", error);
    return json(req, { error: "Failed to manage claim link.", request_id: requestId }, 500);
  }
});
