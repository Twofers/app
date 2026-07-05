import {
  audit,
  cleanString,
  integerInRange,
  json,
  normalizeName,
  nullableString,
  numberInRange,
  readPayload,
  requireAdmin,
  sha256Hex,
} from "../_shared/admin-prospects.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

type ImportInput = Record<string, unknown>;

const ALLOWED_REVIEW_STATUSES = new Set(["needs_review", "approved", "verified", "rejected", "duplicate", "stale"]);

function pickReviewStatus(value: unknown): string {
  const cleaned = cleanString(value, 40);
  return ALLOWED_REVIEW_STATUSES.has(cleaned) ? cleaned : "needs_review";
}

async function findDuplicate(ctx: Awaited<ReturnType<typeof requireAdmin>> & object, input: {
  normalizedName: string;
  postalCode: string | null;
  city: string | null;
}): Promise<string | null> {
  const adminCtx = ctx as any;
  let query = adminCtx.supabaseAdmin
    .from("business_prospects")
    .select("id")
    .eq("normalized_name", input.normalizedName)
    .limit(1);

  if (input.postalCode) {
    query = query.eq("postal_code", input.postalCode);
  } else if (input.city) {
    query = query.ilike("city", input.city);
  }

  const { data, error } = await query;
  if (error) throw error;
  const row = (data ?? [])[0] as { id?: string } | undefined;
  return row?.id ?? null;
}

async function importOne(ctx: any, input: ImportInput) {
  const displayName = cleanString(input.display_name ?? input.business_name ?? input.name, 160);
  if (!displayName) throw new Error("Business name is required.");

  const normalizedName = normalizeName(cleanString(input.normalized_name, 160) || displayName);
  const city = nullableString(input.city, 80);
  const state = nullableString(input.state, 40) || "TX";
  const postalCode = nullableString(input.postal_code ?? input.zip_code, 20);
  const duplicateId = await findDuplicate(ctx, { normalizedName, postalCode, city });
  const sourcePayloadJson = input.source_payload_json && typeof input.source_payload_json === "object"
    ? input.source_payload_json as Record<string, unknown>
    : input;
  const sourcePayloadHash = await sha256Hex(JSON.stringify(sourcePayloadJson));

  const prospectPayload = {
    display_name: displayName,
    normalized_name: normalizedName,
    category: nullableString(input.category, 80),
    subcategory: nullableString(input.subcategory, 80),
    address_line1: nullableString(input.address_line1 ?? input.address, 200),
    address_line2: nullableString(input.address_line2, 120),
    city,
    state,
    postal_code: postalCode,
    country: nullableString(input.country, 2) || "US",
    latitude: numberInRange(input.latitude, null, -90, 90),
    longitude: numberInRange(input.longitude, null, -180, 180),
    source_type: nullableString(input.source_type, 40) || "manual",
    source_confidence: numberInRange(input.source_confidence, 0.75, 0, 1),
    public_label_state: "not_on_twofer_yet",
    status: duplicateId ? "duplicate" : "imported",
    review_status: duplicateId ? "duplicate" : pickReviewStatus(input.review_status),
    duplicate_of_prospect_id: duplicateId,
    private_contact_json: input.private_contact_json && typeof input.private_contact_json === "object"
      ? input.private_contact_json as Record<string, unknown>
      : {},
    created_by_admin_user_id: ctx.user.id,
  };

  const { data: prospect, error: insertError } = await ctx.supabaseAdmin
    .from("business_prospects")
    .insert(prospectPayload)
    .select("id,display_name,city,state,category,status,review_status,duplicate_of_prospect_id,created_at")
    .single();
  if (insertError) throw insertError;

  const sourceProvider = nullableString(input.provider, 80) || prospectPayload.source_type;
  const { error: sourceError } = await ctx.supabaseAdmin.from("business_prospect_sources").insert({
    prospect_id: prospect.id,
    provider: sourceProvider,
    source_url: nullableString(input.source_url, 500),
    source_payload_hash: sourcePayloadHash,
    source_payload_json: sourcePayloadJson,
    confidence: prospectPayload.source_confidence,
    fetched_at: input.fetched_at || new Date().toISOString(),
    stale_at: input.stale_at || null,
    created_by_admin_user_id: ctx.user.id,
  });
  if (sourceError) throw sourceError;

  if (!duplicateId) {
    await ctx.supabaseAdmin.from("sales_accounts").insert({
      prospect_id: prospect.id,
      assigned_admin_user_id: input.assigned_admin_user_id || null,
      stage: "new",
      priority: integerInRange(input.priority_score, 0, 0, 100) >= 75 ? "high" : "normal",
      next_action: "Review source and enrich profile",
    });
  }

  await audit(ctx, {
    action: "admin_prospect_imported",
    targetType: "business_prospect",
    targetId: prospect.id,
    afterValue: {
      display_name: prospect.display_name,
      source_type: prospectPayload.source_type,
      duplicate_of_prospect_id: duplicateId,
    },
    reason: nullableString(input.reason, 500) || "prospect_import",
  });

  return prospect;
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
    const ctx = await requireAdmin(req, requestId, "prospect.import");
    if (ctx instanceof Response) return ctx;
    const payload = await readPayload(req);
    const rawRows = Array.isArray(payload.prospects) ? payload.prospects : [payload.fields ?? payload];
    const rows = rawRows
      .filter((row): row is ImportInput => Boolean(row) && typeof row === "object")
      .slice(0, 250);
    if (!rows.length) {
      return json(req, { error: "At least one prospect is required.", request_id: requestId }, 400);
    }

    const prospects = [];
    for (const row of rows) {
      prospects.push(await importOne(ctx, row));
    }

    return json(req, { ok: true, request_id: requestId, prospects });
  } catch (error) {
    console.error("[admin-prospect-import] error:", error);
    return json(req, { error: error instanceof Error ? error.message : "Failed to import prospects.", request_id: requestId }, 500);
  }
});
