import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendExpoPushBatch, haversineMiles } from "../_shared/expo-push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
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

    const { data: deal, error: dealErr } = await admin
      .from("deals")
      .select("id, title, business_id, businesses(name, latitude, longitude, owner_id)")
      .eq("id", dealId)
      .single();

    if (dealErr || !deal) {
      return jsonResponse({ error: "Deal not found" }, 404);
    }

    const biz = deal.businesses as unknown as {
      name: string | null;
      latitude: number | null;
      longitude: number | null;
      owner_id: string;
    } | null;

    if (!biz || biz.owner_id !== user.id) {
      return jsonResponse({ error: "Not your deal" }, 403);
    }

    const bizLat =
      typeof biz.latitude === "number" ? biz.latitude : null;
    const bizLng =
      typeof biz.longitude === "number" ? biz.longitude : null;
    const businessName = biz.name ?? "TWOFER";
    const dealTitle = deal.title ?? "New deal available!";

    // --- 1. Favorites audience ---
    const { data: favRows } = await admin
      .from("favorites")
      .select("user_id")
      .eq("business_id", deal.business_id);

    const favUserIds = new Set((favRows ?? []).map((r: { user_id: string }) => r.user_id));

    // --- 2. Radius audience (notification_mode = 'all_nearby' with stored location) ---
    const radiusUserIds = new Set<string>();

    if (bizLat != null && bizLng != null) {
      const { data: consumerRows } = await admin
        .from("consumer_profiles")
        .select("user_id, last_latitude, last_longitude, radius_miles")
        .eq("notification_mode", "all_nearby")
        .not("last_latitude", "is", null)
        .not("last_longitude", "is", null);

      for (const row of consumerRows ?? []) {
        const lat = Number(row.last_latitude);
        const lng = Number(row.last_longitude);
        const radius = Number(row.radius_miles) || 3;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const dist = haversineMiles(bizLat, bizLng, lat, lng);
        if (dist <= radius) {
          radiusUserIds.add(row.user_id);
        }
      }
    }

    // --- 3. Merge + exclude merchant ---
    const allUserIds = new Set([...favUserIds, ...radiusUserIds]);
    allUserIds.delete(user.id);

    // Also exclude users with notification_mode = 'none'
    if (allUserIds.size > 0) {
      const { data: optedOut } = await admin
        .from("consumer_profiles")
        .select("user_id")
        .in("user_id", [...allUserIds])
        .eq("notification_mode", "none");

      for (const row of optedOut ?? []) {
        allUserIds.delete(row.user_id);
      }
    }

    if (allUserIds.size === 0) {
      return jsonResponse({ sent: 0, errors: 0, audience: 0 });
    }

    // --- 4. Fetch push tokens ---
    const { data: tokenRows } = await admin
      .from("push_tokens")
      .select("expo_push_token")
      .in("user_id", [...allUserIds]);

    const tokens = (tokenRows ?? []).map(
      (r: { expo_push_token: string }) => r.expo_push_token,
    );

    if (tokens.length === 0) {
      return jsonResponse({ sent: 0, errors: 0, audience: allUserIds.size });
    }

    // --- 5. Send push ---
    const result = await sendExpoPushBatch(tokens, businessName, dealTitle, {
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
