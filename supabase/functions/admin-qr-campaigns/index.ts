import QRCode from "npm:qrcode@1.5.4";

import { getCorsHeaders } from "../_shared/cors.ts";
import {
  UUID_RE,
  audit,
  cleanString,
  integerInRange,
  json,
  readPayload,
  requireAdmin,
} from "../_shared/admin-prospects.ts";

const SOURCE_TYPES = new Set(["counter_sign", "window_sticker", "flyer", "coaster", "table_tent", "other"]);
const DESTINATION_TYPES = new Set(["app_download", "website"]);
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

type Action = "overview" | "create" | "disable" | "qr";

function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://www.twoferapp.com").replace(/\/+$/, "");
}

function trackingUrl(slug: string): string {
  return `${siteUrl()}/r/${encodeURIComponent(slug)}`;
}

function randomSlug(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `q-${[...bytes].map((byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join("")}`;
}

function isAction(value: string): value is Action {
  return value === "overview" || value === "create" || value === "disable" || value === "qr";
}

function campaignPayload(campaign: Record<string, unknown>) {
  const slug = typeof campaign.slug === "string" ? campaign.slug : "";
  return { ...campaign, tracking_url: slug ? trackingUrl(slug) : null };
}

function validUuid(value: unknown): string | null {
  const id = cleanString(value, 80);
  return UUID_RE.test(id) ? id : null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

  const requestId = crypto.randomUUID();
  try {
    const payload = await readPayload(req);
    const actionRaw = cleanString(payload.action, 24);
    if (!isAction(actionRaw)) return json(req, { error: "Unsupported QR campaign action." }, 400);

    const permission = actionRaw === "overview" || actionRaw === "qr" ? "qr.read" : "qr.manage";
    const context = await requireAdmin(req, requestId, permission);
    if (context instanceof Response) return context;

    if (actionRaw === "overview") {
      const days = integerInRange(payload.days, 30, 1, 90);
      const [analyticsResult, businessesResult] = await Promise.all([
        context.supabaseAdmin.rpc("qr_campaign_analytics", { p_days: days }),
        context.supabaseAdmin
          .from("businesses")
          .select("id,name,status")
          .order("name", { ascending: true })
          .limit(500),
      ]);
      if (analyticsResult.error) throw analyticsResult.error;
      if (businessesResult.error) throw businessesResult.error;

      await audit(context, {
        action: "admin_qr_campaigns_viewed",
        targetType: "qr_campaigns",
        reason: `days:${days}`,
      });
      return json(req, {
        ok: true,
        analytics: analyticsResult.data ?? {},
        businesses: businessesResult.data ?? [],
      });
    }

    if (actionRaw === "create") {
      const businessId = validUuid(payload.business_id);
      const sourceType = cleanString(payload.source_type, 40);
      const displayName = cleanString(payload.display_name, 120);
      const destinationType = cleanString(payload.destination_type, 40) || "app_download";
      if (!businessId || !SOURCE_TYPES.has(sourceType) || !displayName || !DESTINATION_TYPES.has(destinationType)) {
        return json(req, { error: "Provide a business, source type, display name, and destination type." }, 400);
      }

      const { data: business, error: businessError } = await context.supabaseAdmin
        .from("businesses")
        .select("id,name")
        .eq("id", businessId)
        .maybeSingle();
      if (businessError) throw businessError;
      if (!business) return json(req, { error: "Business not found." }, 404);

      let inserted: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
        const { data, error } = await context.supabaseAdmin
          .from("qr_campaigns")
          .insert({
            business_id: businessId,
            slug: randomSlug(),
            source_type: sourceType,
            display_name: displayName,
            destination_type: destinationType,
            created_by_admin_id: context.user.id,
          })
          .select("id,business_id,slug,source_type,display_name,destination_type,is_active,disabled_at,created_at")
          .single();
        if (!error) {
          inserted = data as Record<string, unknown>;
          break;
        }
        if (error.code !== "23505") throw error;
      }
      if (!inserted) return json(req, { error: "Could not allocate a unique tracking slug. Please try again." }, 503);

      await audit(context, {
        action: "admin_qr_campaign_created",
        targetType: "qr_campaign",
        targetId: String(inserted.id),
        businessId,
        afterValue: {
          slug: inserted.slug,
          source_type: inserted.source_type,
          display_name: inserted.display_name,
          destination_type: inserted.destination_type,
        },
      });
      return json(req, { ok: true, campaign: campaignPayload(inserted), business });
    }

    const campaignId = validUuid(payload.campaign_id);
    if (!campaignId) return json(req, { error: "Invalid campaign." }, 400);

    if (actionRaw === "disable") {
      const { data: before, error: beforeError } = await context.supabaseAdmin
        .from("qr_campaigns")
        .select("id,business_id,slug,source_type,display_name,destination_type,is_active,disabled_at,created_at")
        .eq("id", campaignId)
        .maybeSingle();
      if (beforeError) throw beforeError;
      if (!before) return json(req, { error: "Campaign not found." }, 404);

      let after = before;
      if (before.is_active) {
        const { data, error } = await context.supabaseAdmin
          .from("qr_campaigns")
          .update({ is_active: false, disabled_at: new Date().toISOString() })
          .eq("id", campaignId)
          .eq("is_active", true)
          .select("id,business_id,slug,source_type,display_name,destination_type,is_active,disabled_at,created_at")
          .maybeSingle();
        if (error) throw error;
        if (data) after = data;
      }

      await audit(context, {
        action: "admin_qr_campaign_disabled",
        targetType: "qr_campaign",
        targetId: campaignId,
        businessId: String(before.business_id),
        beforeValue: { is_active: before.is_active, disabled_at: before.disabled_at },
        afterValue: { is_active: after.is_active, disabled_at: after.disabled_at },
      });
      return json(req, { ok: true, campaign: campaignPayload(after as Record<string, unknown>) });
    }

    const { data: campaign, error: campaignError } = await context.supabaseAdmin
      .from("qr_campaigns")
      .select("id,business_id,slug,display_name,is_active")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) return json(req, { error: "Campaign not found." }, 404);

    const url = trackingUrl(campaign.slug);
    const svg = await QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
      color: { dark: "#11181c", light: "#ffffffff" },
    });
    const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await audit(context, {
      action: "admin_qr_campaign_code_viewed",
      targetType: "qr_campaign",
      targetId: campaignId,
      businessId: campaign.business_id,
    });
    return json(req, {
      ok: true,
      campaign: campaignPayload(campaign as Record<string, unknown>),
      qr_svg_data_url: svgDataUrl,
    });
  } catch (err) {
    console.error("[admin-qr-campaigns] error:", err instanceof Error ? err.message : String(err));
    return json(req, { error: "Could not complete the QR campaign request.", request_id: requestId }, 500);
  }
});
