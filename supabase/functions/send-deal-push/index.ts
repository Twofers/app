import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendExpoPushBatch } from "../_shared/expo-push.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  getSuspendedLocation,
  getSuspendedPrimaryBusinessLocation,
  suspendedLocationResponseBody,
} from "../_shared/billing-suspension.ts";
import { getDealDisplayTitle } from "../../../lib/deal-display-copy.ts";
import {
  buildDealOfferContract,
  buildDeterministicDealChannelCopy,
} from "../../../lib/deal-offer-contract.ts";
import {
  validateDealEligibility,
  type DealEligibilityInput,
} from "../../../lib/deal-eligibility.ts";

const BASE_DEAL_SELECT = "id,title,business_id,location_id,businesses(name,owner_id)";
const STRUCTURED_DEAL_SELECT = [
  "id",
  "title",
  "business_id",
  "location_id",
  "start_time",
  "end_time",
  "max_claims",
  "deal_type",
  "applies_to",
  "discount_percent",
  "required_purchase_quantity",
  "free_item_quantity",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_description",
  "free_item_retail_value_cents",
  "free_item_discount_percent",
  "item_description",
  "item_retail_value_cents",
  "businesses(name,owner_id)",
].join(",");

type DealPushBusiness = {
  name: string | null;
  owner_id: string | null;
};

type DealPushRow = Record<string, unknown> & {
  id: string;
  title: string | null;
  business_id: string;
  businesses: DealPushBusiness | DealPushBusiness[] | null;
};

function isMissingStructuredColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dealEligibilityFromRow(row: Record<string, unknown>): DealEligibilityInput | null {
  const dealType = typeof row.deal_type === "string" ? row.deal_type : "";
  if (!dealType) return null;
  return {
    dealType,
    appliesTo: typeof row.applies_to === "string" ? row.applies_to : "SINGLE_ITEM",
    discountPercent: row.discount_percent as number | string | null | undefined,
    requiredPurchaseQuantity: row.required_purchase_quantity as number | string | null | undefined,
    freeItemQuantity: row.free_item_quantity as number | string | null | undefined,
    requiredItemDescription: row.required_item_description as string | null | undefined,
    requiredItemRetailValueCents: row.required_item_retail_value_cents as number | string | null | undefined,
    freeItemDescription: row.free_item_description as string | null | undefined,
    freeItemRetailValueCents: row.free_item_retail_value_cents as number | string | null | undefined,
    freeItemDiscountPercent: row.free_item_discount_percent as number | string | null | undefined,
    itemDescription: row.item_description as string | null | undefined,
    itemRetailValueCents: row.item_retail_value_cents as number | string | null | undefined,
  };
}

function buildPushCopy(row: Record<string, unknown>, businessName: string): { title: string; body: string } {
  const fallbackTitle = getDealDisplayTitle(row, typeof row.title === "string" ? row.title : null) || "Limited-time local offer";
  const eligibilityInput = dealEligibilityFromRow(row);
  if (eligibilityInput) {
    const eligibilityResult = validateDealEligibility(eligibilityInput);
    const contract = buildDealOfferContract({
      businessId: String(row.business_id ?? ""),
      businessName,
      locationName: businessName,
      dealEligibility: eligibilityInput,
      eligibilityResult,
      quantityLimit: asNumber(row.max_claims),
      activeWindowHumanReadable:
        row.start_time && row.end_time ? `${String(row.start_time)} to ${String(row.end_time)}` : null,
    });
    if (contract) {
      const copy = buildDeterministicDealChannelCopy(contract);
      return { title: copy.pushTitle, body: copy.pushBody };
    }
  }
  const hasLimit = asNumber(row.max_claims) != null;
  return {
    title: fallbackTitle,
    body: hasLimit ? `Live now at ${businessName}. Claims are limited.` : `Live now at ${businessName}. Open Twofer for details.`,
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResponse(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const {
      data: { user },
      error: authErr,
    } = await authClient.auth.getUser();
    if (authErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: { deal_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const dealId = body?.deal_id;
    if (!dealId || typeof dealId !== "string") {
      return jsonResponse({ error: "deal_id is required" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    let dealQuery = await admin
      .from("deals")
      .select(STRUCTURED_DEAL_SELECT)
      .eq("id", dealId)
      .single();
    if (isMissingStructuredColumn(dealQuery.error)) {
      dealQuery = await admin
        .from("deals")
        .select(BASE_DEAL_SELECT)
        .eq("id", dealId)
        .single();
    }
    const { data: rawDeal, error: dealErr } = dealQuery;
    const deal = rawDeal as unknown as DealPushRow | null;

    if (dealErr || !deal) {
      return jsonResponse({ error: "Deal not found" }, 404);
    }

    const biz = Array.isArray(deal.businesses) ? deal.businesses[0] ?? null : deal.businesses;

    if (!biz || biz.owner_id !== user.id) {
      return jsonResponse({ error: "Not your deal" }, 403);
    }

    const suspendedLocation =
      await getSuspendedLocation(admin as any, typeof deal.location_id === "string" ? deal.location_id : null) ??
        await getSuspendedPrimaryBusinessLocation(admin as any, deal.business_id);
    if (suspendedLocation) {
      return jsonResponse(suspendedLocationResponseBody("send deal notifications"), 403);
    }

    const businessName = biz.name ?? "a local business";
    const pushCopy = buildPushCopy(deal, businessName);

    // --- 1. Favorites audience ---
    const { data: favRows } = await admin
      .from("favorites")
      .select("user_id")
      .eq("business_id", deal.business_id);

    const favUserIds = new Set((favRows ?? []).map((r: { user_id: string }) => r.user_id));

    if (favUserIds.size === 0) {
      return jsonResponse({ sent: 0, errors: 0, audience: 0 });
    }

    // --- 2. Server-side opt-in gate ---
    const { data: optedInRows } = await admin
      .from("consumer_profiles")
      .select("user_id")
      .in("user_id", [...favUserIds])
      .eq("deal_alerts_enabled", true)
      .neq("notification_mode", "none");

    const allUserIds = new Set((optedInRows ?? []).map((r: { user_id: string }) => r.user_id));
    allUserIds.delete(user.id);

    if (allUserIds.size === 0) {
      return jsonResponse({ sent: 0, errors: 0, audience: 0 });
    }

    // --- 3. Fetch push tokens ---
    const { data: tokenRows } = await admin
      .from("push_tokens")
      .select("expo_push_token")
      .in("user_id", [...allUserIds]);

    const tokens = (tokenRows ?? [])
      .map((r: { expo_push_token: string }) => r.expo_push_token?.trim())
      .filter((token): token is string => Boolean(token));

    if (tokens.length === 0) {
      return jsonResponse({ sent: 0, errors: 0, audience: allUserIds.size });
    }

    // --- 4. Send push ---
    const result = await sendExpoPushBatch(tokens, pushCopy.title, pushCopy.body, {
      dealId: deal.id,
      path: `/deal/${deal.id}`,
    });

    return jsonResponse({
      ...result,
      audience: allUserIds.size,
      tokens: tokens.length,
    });
  } catch (err) {
    console.error("[send-deal-push] Unhandled error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
