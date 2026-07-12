// Admin content-moderation queue (Apple App Store guideline 1.2 "timely response").
//
// Surfaces the two report tables written by the in-app "Report" flows:
//   business_reports — a customer flagged a business/offer
//   user_reports     — a business flagged a customer
// so the founder/moderator can review them in one place and mark each open item
// reviewed or dismissed. Actual takedown (deactivating an offer or business) still
// lives in the existing Businesses/Offers admin tools — this is triage only.
//
// Auth mirrors the other admin functions via requireAdmin(): reads need
// moderation.read, status changes need moderation.write.

import {
  audit,
  cleanString,
  json,
  readPayload,
  requireAdmin,
  UUID_RE,
  type ProspectPermission,
} from "../_shared/admin-prospects.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const REPORT_STATUSES = new Set(["open", "reviewed", "dismissed"]);
const LIST_LIMIT = 200;

type ReportRow = Record<string, unknown> & {
  business_id?: string | null;
  deal_id?: string | null;
  reporter_business_id?: string | null;
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

    const permission: ProspectPermission = action === "set_status" ? "moderation.write" : "moderation.read";
    const ctx = await requireAdmin(req, requestId, permission);
    if (ctx instanceof Response) return ctx;
    const admin = ctx.supabaseAdmin;

    if (action === "list") {
      const [{ data: businessReports, error: bizErr }, { data: userReports, error: userErr }] = await Promise.all([
        admin
          .from("business_reports")
          .select("id,business_id,deal_id,reporter_user_id,reason,comment,status,created_at")
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT),
        admin
          .from("user_reports")
          .select("id,reported_user_id,reporter_business_id,reporter_user_id,claim_id,reason,comment,status,created_at")
          .order("created_at", { ascending: false })
          .limit(LIST_LIMIT),
      ]);
      if (bizErr) throw bizErr;
      if (userErr) throw userErr;

      // Resolve business names + deal titles in bulk (avoids fragile PostgREST FK
      // embeds and keeps this readable). Two report types reference businesses via
      // different columns, so collect ids from both.
      const businessIds = new Set<string>();
      const dealIds = new Set<string>();
      for (const r of (businessReports ?? []) as ReportRow[]) {
        if (r.business_id) businessIds.add(r.business_id);
        if (r.deal_id) dealIds.add(r.deal_id);
      }
      for (const r of (userReports ?? []) as ReportRow[]) {
        if (r.reporter_business_id) businessIds.add(r.reporter_business_id);
      }

      const [bizNames, dealTitles] = await Promise.all([
        businessIds.size
          ? admin.from("businesses").select("id,name").in("id", [...businessIds])
          : Promise.resolve({ data: [] as { id: string; name: string | null }[], error: null }),
        dealIds.size
          ? admin.from("deals").select("id,title").in("id", [...dealIds])
          : Promise.resolve({ data: [] as { id: string; title: string | null }[], error: null }),
      ]);

      const nameById = new Map<string, string>();
      for (const b of (bizNames.data ?? []) as { id: string; name: string | null }[]) {
        nameById.set(b.id, b.name ?? "");
      }
      const titleById = new Map<string, string>();
      for (const d of (dealTitles.data ?? []) as { id: string; title: string | null }[]) {
        titleById.set(d.id, d.title ?? "");
      }

      return json(req, {
        ok: true,
        request_id: requestId,
        business_reports: ((businessReports ?? []) as ReportRow[]).map((r) => ({
          ...r,
          business_name: r.business_id ? nameById.get(r.business_id) ?? null : null,
          deal_title: r.deal_id ? titleById.get(r.deal_id) ?? null : null,
        })),
        user_reports: ((userReports ?? []) as ReportRow[]).map((r) => ({
          ...r,
          reporter_business_name: r.reporter_business_id ? nameById.get(r.reporter_business_id) ?? null : null,
        })),
      });
    }

    if (action === "set_status") {
      const reportType = cleanString(payload.report_type, 20);
      const reportId = cleanString(payload.report_id, 80);
      const status = cleanString(payload.status, 20);

      if (reportType !== "business" && reportType !== "user") {
        return json(req, { error: "Invalid report type.", request_id: requestId }, 400);
      }
      if (!UUID_RE.test(reportId)) {
        return json(req, { error: "Invalid report id.", request_id: requestId }, 400);
      }
      if (!REPORT_STATUSES.has(status)) {
        return json(req, { error: "Invalid status.", request_id: requestId }, 400);
      }

      const table = reportType === "business" ? "business_reports" : "user_reports";
      const { data, error } = await admin
        .from(table)
        .update({ status })
        .eq("id", reportId)
        .select("id,status")
        .maybeSingle();
      if (error) throw error;
      if (!data) return json(req, { error: "Report not found.", request_id: requestId }, 404);

      await audit(ctx, {
        action: "admin_content_report_status_changed",
        targetType: table,
        targetId: reportId,
        afterValue: { status },
        reason: status,
      });

      return json(req, { ok: true, request_id: requestId, report: data });
    }

    return json(req, { error: "Unknown reports action.", request_id: requestId }, 400);
  } catch (error) {
    console.error("[admin-reports] error:", error);
    return json(req, { error: "Failed to load content reports.", request_id: requestId }, 500);
  }
});
