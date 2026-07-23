// Admin review queue for business name change requests (identity lock).
//
// Once a business is publicly visible its display name is frozen for the
// owner (enforce_businesses_protected_columns trigger + the
// update-business-profile-section check, migration 20260816120000). Owners
// file a proposed name into business_name_change_requests; this function is
// the ONLY path that applies an approved rename to the canonical
// businesses.name (service_role, trigger-exempt), recording who decided,
// old/new values, reason, and timestamp.
//
// Auth mirrors the other admin functions via requireAdmin(): reads need
// moderation.read, approve/reject need moderation.write.

import {
  audit,
  cleanString,
  json,
  nullableString,
  readPayload,
  requireAdmin,
  UUID_RE,
  type ProspectPermission,
} from "../_shared/admin-prospects.ts";
import { upsertBusinessProfileForOwner } from "../_shared/business-onboarding-sync.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const LIST_LIMIT = 200;

type NameRequestRow = {
  id: string;
  business_id: string;
  requested_by: string | null;
  field_key: string;
  current_value: string | null;
  proposed_value: string;
  reason: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  created_at: string;
};

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
    const payload = req.method === "GET" ? {} : await readPayload(req);
    const action = cleanString(payload.action, 40) || "list";

    const permission: ProspectPermission =
      action === "approve" || action === "reject" ? "moderation.write" : "moderation.read";
    const ctx = await requireAdmin(req, requestId, permission);
    if (ctx instanceof Response) return ctx;
    const admin = ctx.supabaseAdmin;

    if (action === "list") {
      const { data: requests, error: listErr } = await admin
        .from("business_name_change_requests")
        .select("id,business_id,requested_by,field_key,current_value,proposed_value,reason,status,decided_by,decided_at,decision_reason,created_at")
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (listErr) throw listErr;

      const requestRows = (requests ?? []) as NameRequestRow[];
      const businessIds = [...new Set(requestRows.map((r) => r.business_id).filter(Boolean))];
      const { data: businesses } = businessIds.length
        ? await admin.from("businesses").select("id,name,status").in("id", businessIds)
        : { data: [] as { id: string; name: string | null; status: string | null }[] };
      const businessById = new Map(
        ((businesses ?? []) as { id: string; name: string | null; status: string | null }[]).map((b) => [b.id, b]),
      );

      return json(req, {
        ok: true,
        request_id: requestId,
        requests: requestRows.map((r) => ({
          ...r,
          business_name: businessById.get(r.business_id)?.name ?? null,
          business_status: businessById.get(r.business_id)?.status ?? null,
        })),
      });
    }

    if (action === "approve" || action === "reject") {
      const nameRequestId = cleanString(payload.request_id, 80);
      const decisionReason = nullableString(payload.decision_reason, 500);
      if (!UUID_RE.test(nameRequestId)) {
        return json(req, { error: "Invalid request id.", request_id: requestId }, 400);
      }

      const { data: nameRequest, error: reqErr } = await admin
        .from("business_name_change_requests")
        .select("id,business_id,requested_by,field_key,current_value,proposed_value,reason,status")
        .eq("id", nameRequestId)
        .maybeSingle();
      if (reqErr) throw reqErr;
      if (!nameRequest) {
        return json(req, { error: "Name change request not found.", request_id: requestId }, 404);
      }
      if (nameRequest.status !== "pending") {
        return json(req, { error: "This request was already decided.", request_id: requestId }, 409);
      }

      const { data: business, error: bizErr } = await admin
        .from("businesses")
        .select("id,owner_id,name,status,address,category,current_profile_version")
        .eq("id", nameRequest.business_id)
        .maybeSingle();
      if (bizErr) throw bizErr;
      if (!business) {
        return json(req, { error: "Business not found.", request_id: requestId }, 404);
      }

      const decidedAt = new Date().toISOString();
      const previousName = business.name ?? null;

      if (action === "approve") {
        const newName = cleanString(nameRequest.proposed_value, 120);
        if (!newName) {
          return json(req, { error: "Proposed name is empty.", request_id: requestId }, 400);
        }

        // Bump current_profile_version so open app sessions get the standard
        // profile_conflict refresh instead of silently overwriting the rename.
        const { error: renameErr } = await admin
          .from("businesses")
          .update({
            name: newName,
            current_profile_version: Number(business.current_profile_version ?? 1) + 1,
          })
          .eq("id", business.id);
        if (renameErr) throw renameErr;

        if (business.owner_id) {
          // Pass the business's current address/category through — the upsert
          // overwrites every field it is given, so nulls would clobber them.
          await upsertBusinessProfileForOwner(admin, {
            userId: business.owner_id,
            name: newName,
            address: business.address ?? null,
            category: business.category ?? null,
            setupCompleted: true,
          });
        }

        await admin.from("business_profile_field_sources").upsert(
          {
            business_id: business.id,
            field_key: "business.display_name",
            source: "admin_name_change_approval",
            current_value: newName,
            last_updated_at: decidedAt,
            last_updated_by_user_id: ctx.user.id,
            requires_review: false,
            review_status: "not_required",
          },
          { onConflict: "business_id,field_key" },
        );

        await admin.from("business_profile_revision_log").insert({
          business_id: business.id,
          actor_user_id: ctx.user.id,
          actor_type: "admin",
          source: "admin_name_change_approval",
          section_key: "business.display_name",
          before_value: { name: previousName },
          after_value: { name: newName },
          requires_review: false,
          review_status: "not_required",
        });
      }

      const { data: decided, error: decideErr } = await admin
        .from("business_name_change_requests")
        .update({
          status: action === "approve" ? "approved" : "rejected",
          decided_by: ctx.user.id,
          decided_at: decidedAt,
          decision_reason: decisionReason,
        })
        .eq("id", nameRequest.id)
        .eq("status", "pending")
        .select("id,status,decided_at")
        .maybeSingle();
      if (decideErr) throw decideErr;
      if (!decided) {
        return json(req, { error: "This request was already decided.", request_id: requestId }, 409);
      }

      await audit(ctx, {
        action: action === "approve" ? "admin_business_name_change_approved" : "admin_business_name_change_rejected",
        targetType: "business_name_change_request",
        targetId: nameRequest.id,
        businessId: business.id,
        beforeValue: { name: previousName },
        afterValue: action === "approve" ? { name: nameRequest.proposed_value } : { name: previousName },
        reason: decisionReason,
      });

      await admin.from("system_events").insert({
        event_type: action === "approve" ? "business_name_change_approved" : "business_name_change_rejected",
        source: "admin_dashboard",
        message: action === "approve"
          ? "Business name change approved and applied."
          : "Business name change rejected.",
        metadata: {
          business_id: business.id,
          request_id: nameRequest.id,
          admin_user_id: ctx.user.id,
          previous_name: previousName,
          proposed_name: nameRequest.proposed_value,
        },
      });

      return json(req, { ok: true, request_id: requestId, request: decided });
    }

    return json(req, { error: "Unknown name request action.", request_id: requestId }, 400);
  } catch (error) {
    console.error("[admin-business-name-requests] error:", error);
    return json(req, { error: "Failed to process name change requests.", request_id: requestId }, 500);
  }
});
