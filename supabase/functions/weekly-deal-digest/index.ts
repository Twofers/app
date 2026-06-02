// Weekly "new deals near you" digest — a REAL per-user re-engagement push.
//
// For each OPTED-IN consumer (consumer_profiles.deal_alerts_enabled = true, synced
// from the in-app toggle), counts deals created in the last 7 days that they should
// hear about — honoring radius + stored location and favorites (favorites_only counts
// only favorited shops; all_nearby also always includes favorited shops) — and sends
// a personalized push. Reaches users even when the app is closed.
//
// Targeting logic lives in ../_shared/digest-targeting.ts (unit-tested). Invocation is
// guarded by a shared secret (CRON_SECRET). POST { "dry_run": true } returns the
// computed audience WITHOUT sending. Schedule weekly (see README.md).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendExpoPushMessages, type ExpoPushMessage } from "../_shared/expo-push.ts";
import { computeDigestCounts, type DigestConsumer, type DigestDeal } from "../_shared/digest-targeting.ts";

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

  // Only the scheduler (or an admin with the secret) may trigger this.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const dryRun = body?.dry_run === true;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const nowIso = new Date().toISOString();
    const sinceIso = new Date(Date.now() - DIGEST_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // 1. Recently-posted, still-live deals + their business coordinates.
    const { data: dealRows, error: dealErr } = await admin
      .from("deals")
      .select("id, business_id, created_at, businesses(latitude, longitude)")
      .eq("is_active", true)
      .gte("created_at", sinceIso)
      .gte("end_time", nowIso)
      .limit(5000);
    if (dealErr) {
      console.error("[weekly-deal-digest] deals query failed:", dealErr);
      return jsonResponse({ error: "deals query failed" }, 500);
    }

    const deals: DigestDeal[] = (dealRows ?? []).map((d) => {
      const b = d.businesses as unknown as { latitude: number | null; longitude: number | null } | null;
      return {
        business_id: d.business_id as string,
        lat: b?.latitude != null ? Number(b.latitude) : null,
        lng: b?.longitude != null ? Number(b.longitude) : null,
      };
    });
    if (deals.length === 0) {
      return jsonResponse({ ok: true, audience: 0, sent: 0, reason: "no recent deals" });
    }

    // 2. Opted-in consumers ONLY (deal_alerts_enabled = true is the consent gate).
    const { data: consumerRows, error: consErr } = await admin
      .from("consumer_profiles")
      .select("user_id, deal_alerts_enabled, notification_mode, last_latitude, last_longitude, radius_miles")
      .eq("deal_alerts_enabled", true);
    if (consErr) {
      console.error("[weekly-deal-digest] consumers query failed:", consErr);
      return jsonResponse({ error: "consumers query failed" }, 500);
    }
    const base = consumerRows ?? [];
    if (base.length === 0) {
      return jsonResponse({ ok: true, audience: 0, sent: 0, reason: "no opted-in consumers" });
    }

    // 3. Favorites for those users (so favorites_only + the override work).
    const userIds = base.map((r) => r.user_id as string);
    const favByUser = new Map<string, string[]>();
    const { data: favRows } = await admin.from("favorites").select("user_id, business_id").in("user_id", userIds);
    for (const f of favRows ?? []) {
      const arr = favByUser.get(f.user_id as string) ?? [];
      arr.push(f.business_id as string);
      favByUser.set(f.user_id as string, arr);
    }

    const consumers: DigestConsumer[] = base.map((r) => ({
      user_id: r.user_id as string,
      deal_alerts_enabled: r.deal_alerts_enabled === true,
      notification_mode: (r.notification_mode as string | null) ?? null,
      lat: r.last_latitude != null ? Number(r.last_latitude) : null,
      lng: r.last_longitude != null ? Number(r.last_longitude) : null,
      radius_miles: r.radius_miles != null ? Number(r.radius_miles) : null,
      favorite_business_ids: favByUser.get(r.user_id as string) ?? [],
    }));

    // 4. Per-user counts (pure, unit-tested, never throws).
    const counts = computeDigestCounts(deals, consumers);
    if (counts.size === 0) {
      return jsonResponse({ ok: true, audience: 0, sent: 0, reason: "no users with qualifying deals" });
    }

    if (dryRun) {
      // Aggregate proof — who would be targeted, without sending or leaking PII.
      const distribution: Record<string, number> = {};
      for (const n of counts.values()) {
        const k = String(n);
        distribution[k] = (distribution[k] ?? 0) + 1;
      }
      return jsonResponse({
        ok: true,
        dry_run: true,
        recent_deals: deals.length,
        opted_in_consumers: consumers.length,
        audience: counts.size,
        count_distribution: distribution,
      });
    }

    // 5. Push tokens for the audience, build personalized messages, send.
    const { data: tokenRows } = await admin
      .from("push_tokens")
      .select("user_id, expo_push_token")
      .in("user_id", [...counts.keys()]);

    const messages: ExpoPushMessage[] = [];
    for (const row of tokenRows ?? []) {
      const count = counts.get(row.user_id as string);
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
    return jsonResponse({ ok: true, audience: counts.size, tokens: messages.length, ...result });
  } catch (err) {
    console.error("[weekly-deal-digest] Unhandled error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
