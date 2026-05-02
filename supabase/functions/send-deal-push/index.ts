import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sendExpoPushBatch, haversineMiles } from "../_shared/expo-push.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { adminClient, userClient } from "../_shared/auth-clients.ts";

/** Cooldown between pushes for the same deal (avoids merchant spamming favoriters). */
const PER_DEAL_PUSH_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
/** Max pushes per business per UTC day. */
const PER_BUSINESS_DAILY_PUSH_CAP = 5;

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
    const authClient = userClient(req);

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

    const admin = adminClient();

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

    // --- Throttle: per-deal cooldown ---
    const cooldownSinceIso = new Date(Date.now() - PER_DEAL_PUSH_COOLDOWN_MS).toISOString();
    const { count: recentForDeal } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", deal.business_id)
      .eq("request_type", "deal_push")
      .eq("request_hash", `deal:${deal.id}`)
      .gte("created_at", cooldownSinceIso);

    if ((recentForDeal ?? 0) > 0) {
      return jsonResponse({
        sent: 0,
        errors: 0,
        audience: 0,
        skipped: "cooldown_active",
        message: "This deal was already pushed within the last 6 hours.",
      });
    }

    // --- Throttle: per-business daily cap ---
    const dailySinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dailyCount } = await admin
      .from("ai_generation_logs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", deal.business_id)
      .eq("request_type", "deal_push")
      .gte("created_at", dailySinceIso);

    if ((dailyCount ?? 0) >= PER_BUSINESS_DAILY_PUSH_CAP) {
      return jsonResponse({
        sent: 0,
        errors: 0,
        audience: 0,
        skipped: "daily_cap_reached",
        message: `Daily push cap (${PER_BUSINESS_DAILY_PUSH_CAP}) reached for this business.`,
      });
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
      // Still log so the throttle counter advances even on zero-audience attempts.
      await admin.from("ai_generation_logs").insert({
        business_id: deal.business_id,
        user_id: user.id,
        request_type: "deal_push",
        input_mode: "audience",
        request_hash: `deal:${deal.id}`,
        prompt_version: "v1",
        success: true,
        openai_called: false,
      });
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
      await admin.from("ai_generation_logs").insert({
        business_id: deal.business_id,
        user_id: user.id,
        request_type: "deal_push",
        input_mode: "no_tokens",
        request_hash: `deal:${deal.id}`,
        prompt_version: "v1",
        success: true,
        openai_called: false,
      });
      return jsonResponse({ sent: 0, errors: 0, audience: allUserIds.size });
    }

    // --- 5. Send push ---
    const result = await sendExpoPushBatch(tokens, businessName, dealTitle, {
      dealId: deal.id,
      path: `/deal/${deal.id}`,
    });

    // --- 6. Log for throttle tracking ---
    await admin.from("ai_generation_logs").insert({
      business_id: deal.business_id,
      user_id: user.id,
      request_type: "deal_push",
      input_mode: "send",
      request_hash: `deal:${deal.id}`,
      prompt_version: "v1",
      success: true,
      openai_called: false,
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
