// Weekly "new deals near you" digest — a REAL per-user re-engagement push.
//
// For each opted-in consumer with a stored location, counts deals created in the
// last 7 days whose business is within the consumer's radius, and sends a push
// with that personalized count. Reaches users even when the app is closed (unlike
// a local notification).
//
// Consent model matches send-deal-push: a row in push_tokens (the user granted OS
// push permission) plus consumer_profiles.notification_mode != 'none'.
//
// Invocation is guarded by a shared secret (CRON_SECRET env) so only the scheduler
// can trigger a mass send. Schedule it weekly (see README.md in this folder).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendExpoPushMessages, haversineMiles, type ExpoPushMessage } from "../_shared/expo-push.ts";

const DIGEST_DAYS = 7;

serve(async (req) => {
  function jsonResponse(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Only the scheduler may trigger this (prevents abuse / accidental mass sends).
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const nowIso = new Date().toISOString();
    const sinceIso = new Date(Date.now() - DIGEST_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // 1. Recently-posted, still-live deals + their business coordinates.
    const { data: dealRows, error: dealErr } = await admin
      .from("deals")
      .select("id, created_at, businesses(latitude, longitude)")
      .eq("is_active", true)
      .gte("created_at", sinceIso)
      .gte("end_time", nowIso)
      .limit(5000);
    if (dealErr) {
      console.error("[weekly-deal-digest] deals query failed:", dealErr);
      return jsonResponse({ error: "deals query failed" }, 500);
    }

    const recentDeals = (dealRows ?? [])
      .map((d) => {
        const b = d.businesses as unknown as { latitude: number | null; longitude: number | null } | null;
        const lat = b?.latitude != null ? Number(b.latitude) : NaN;
        const lng = b?.longitude != null ? Number(b.longitude) : NaN;
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
      })
      .filter((x): x is { lat: number; lng: number } => x !== null);

    if (recentDeals.length === 0) {
      return jsonResponse({ ok: true, audience: 0, sent: 0, reason: "no recent deals" });
    }

    // 2. Opted-in consumers with a stored location.
    const { data: consumerRows } = await admin
      .from("consumer_profiles")
      .select("user_id, last_latitude, last_longitude, radius_miles")
      .not("last_latitude", "is", null)
      .not("last_longitude", "is", null)
      .neq("notification_mode", "none");

    // 3. Per-user count of recent deals within their radius.
    const perUserCount = new Map<string, number>();
    for (const row of consumerRows ?? []) {
      const lat = Number(row.last_latitude);
      const lng = Number(row.last_longitude);
      const radius = Number(row.radius_miles) || 15;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      let count = 0;
      for (const d of recentDeals) {
        if (haversineMiles(lat, lng, d.lat, d.lng) <= radius) count++;
      }
      if (count > 0) perUserCount.set(row.user_id as string, count);
    }

    if (perUserCount.size === 0) {
      return jsonResponse({ ok: true, audience: 0, sent: 0, reason: "no users with nearby new deals" });
    }

    // 4. Push tokens for those users.
    const { data: tokenRows } = await admin
      .from("push_tokens")
      .select("user_id, expo_push_token")
      .in("user_id", [...perUserCount.keys()]);

    // 5. Build a personalized message per token and send.
    const messages: ExpoPushMessage[] = [];
    for (const row of tokenRows ?? []) {
      const count = perUserCount.get(row.user_id as string);
      if (!count) continue;
      messages.push({
        to: row.expo_push_token as string,
        title: "New deals near you",
        body: count === 1 ? "1 new deal near you this week." : `${count} new deals near you this week.`,
        data: { path: "/(tabs)" },
        sound: "default",
        channelId: "deal-alerts",
      });
    }

    const result = await sendExpoPushMessages(messages);
    return jsonResponse({ ok: true, audience: perUserCount.size, tokens: messages.length, ...result });
  } catch (err) {
    console.error("[weekly-deal-digest] Unhandled error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
