import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendExpoPushBatch } from "../_shared/expo-push.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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
      .select("id, title, business_id, businesses(name, owner_id)")
      .eq("id", dealId)
      .single();

    if (dealErr || !deal) {
      return jsonResponse({ error: "Deal not found" }, 404);
    }

    const biz = deal.businesses as unknown as {
      name: string | null;
      owner_id: string;
    } | null;

    if (!biz || biz.owner_id !== user.id) {
      return jsonResponse({ error: "Not your deal" }, 403);
    }

    const businessName = biz.name ?? "TWOFER";
    const dealTitle = deal.title ?? "New deal available!";

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
