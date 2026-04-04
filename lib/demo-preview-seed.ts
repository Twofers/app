import type { SupabaseClient } from "@supabase/supabase-js";

import { DEMO_PREVIEW_EMAIL, isDemoPreviewAccountEmail } from "@/lib/demo-account";

/** Matches `supabase/seed_demo_coffee_business.sql` (canonical preview business + deals). */
const CANONICAL_BUSINESS = {
  name: "Demo Roasted Bean Coffee",
  address: "1234 Commerce St",
  location: "Dallas, TX",
  latitude: 32.7831,
  longitude: -96.8067,
  phone: "(214) 555-0100",
  hours_text: "Mon–Fri 7 AM – 7 PM · Sat–Sun 8 AM – 6 PM",
  short_description: "Neighborhood espresso bar for Twofer preview testers.",
  category: "Coffee shop",
  contact_name: "Demo Owner",
  business_email: "hello@demo.twofer.app",
} as const;

const CANONICAL_BUSINESS_PROFILE = {
  name: "Demo Roasted Bean Coffee",
  address: "1234 Commerce St",
  category: "Coffee Shop",
  setup_completed: true,
} as const;

const DEMO_LOCATION = {
  name: "Downtown Dallas Cafe",
  address: "1234 Commerce St, Dallas, TX 75202",
  phone: "(214) 555-0100",
  lat: 32.7831,
  lng: -96.8067,
} as const;

const DEMO_MENU_ITEMS = [
  { name: "Oat Milk Latte", category: "Coffee", price_text: "$6.50", description: "Double shot with house oat milk." },
  { name: "Vanilla Cortado", category: "Coffee", price_text: "$5.25", description: "Short milk-forward espresso drink." },
  { name: "Single-Origin Cold Brew", category: "Cold Coffee", price_text: "$5.75", description: "Rotating seasonal single-origin brew." },
  { name: "Matcha Latte", category: "Tea", price_text: "$6.00", description: "Ceremonial matcha with choice of milk." },
  { name: "Butter Croissant", category: "Pastry", price_text: "$4.25", description: "Flaky all-butter morning pastry." },
  { name: "Blueberry Muffin", category: "Pastry", price_text: "$4.50", description: "Baked in-house with lemon sugar top." },
] as const;

const DEMO_DEALS = [
  {
    title: "2-for-1 oat milk lattes (live)",
    description: "Buy one oat milk latte, get one free for your coworker.",
    price: 6.5,
    max_claims: 220,
    poster_url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80",
    kind: "live" as const,
    durationDays: 20,
  },
  {
    title: "Morning pastry pair + drip (live)",
    description: "Two pastries and two medium drips for one combo price before noon.",
    price: 7.5,
    max_claims: 180,
    poster_url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80",
    kind: "live" as const,
    durationDays: 16,
  },
  {
    title: "After-school iced latte happy hour (scheduled)",
    description: "Starts this week: buy one iced latte, get a second 50% off.",
    price: 6.0,
    max_claims: 140,
    poster_url: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80",
    kind: "scheduled" as const,
    startOffsetDays: 2,
    endOffsetDays: 12,
  },
  {
    title: "Weekday 2-for-1 cold brew window (recurring)",
    description: "Recurring Mon-Fri 2:00-5:00 PM cold brew 2-for-1 special.",
    price: 5.75,
    max_claims: 260,
    poster_url: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=1200&q=80",
    kind: "recurring" as const,
    days_of_week: [1, 2, 3, 4, 5],
    window_start_minutes: 14 * 60,
    window_end_minutes: 17 * 60,
    durationDays: 30,
  },
  {
    title: "Saturday bakery box bogo (recurring)",
    description: "Every Saturday morning: buy one pastry box, get one free.",
    price: 12.0,
    max_claims: 120,
    poster_url: "https://images.unsplash.com/photo-1483695028939-5bb13f8648b0?w=1200&q=80",
    kind: "recurring" as const,
    days_of_week: [6],
    window_start_minutes: 8 * 60,
    window_end_minutes: 12 * 60,
    durationDays: 45,
  },
] as const;

const SEEDED_DEAL_TITLES = DEMO_DEALS.map((d) => d.title);
const DEMO_ANALYTICS_EVENT_SEED = "demo_business_seed_v2";

function isLegacyAccountStub(row: {
  category: string | null;
  business_email: string | null;
  location: string | null;
}): boolean {
  if (row.category?.trim() === "Demo") return true;
  if (row.business_email?.trim().toLowerCase() === "hello@demo.twofer.app" && row.location?.includes("Austin")) {
    return true;
  }
  return false;
}

function safeIso(date: Date): string {
  return date.toISOString();
}

function buildSeedDealRows(now: Date, businessId: string, locationId: string | null) {
  return DEMO_DEALS.map((d) => {
    const start = new Date(now);
    const end = new Date(now);

    if (d.kind === "scheduled") {
      start.setUTCDate(start.getUTCDate() + (d.startOffsetDays ?? 0));
      end.setUTCDate(end.getUTCDate() + (d.endOffsetDays ?? 14));
    } else {
      end.setUTCDate(end.getUTCDate() + (d.durationDays ?? 14));
    }

    return {
      business_id: businessId,
      location_id: locationId,
      title: d.title,
      description: d.description,
      price: d.price,
      start_time: safeIso(start),
      end_time: safeIso(end),
      claim_cutoff_buffer_minutes: 30,
      max_claims: d.max_claims,
      is_active: true,
      poster_url: d.poster_url,
      poster_storage_path: null,
      quality_tier: "acceptable",
      is_recurring: d.kind === "recurring",
      days_of_week: d.kind === "recurring" ? d.days_of_week : null,
      window_start_minutes: d.kind === "recurring" ? d.window_start_minutes : null,
      window_end_minutes: d.kind === "recurring" ? d.window_end_minutes : null,
      timezone: d.kind === "recurring" ? "America/Chicago" : null,
    };
  });
}

/**
 * After demo login, ensures the canonical coffee business and sample deals exist (client-side, RLS-safe).
 * Idempotent: refreshes canonical demo rows and preserves non-seed records.
 */
export async function ensureDemoCoffeePreview(client: SupabaseClient): Promise<void> {
  const {
    data: { session },
  } = await client.auth.getSession();
  const email = session?.user?.email;
  if (!session?.user?.id || !isDemoPreviewAccountEmail(email)) return;

  const uid = session.user.id;
  const trialEndsAtIso = new Date(Date.now() + 30 * 86400000).toISOString();

  const { data: biz, error: bizReadErr } = await client
    .from("businesses")
    .select("id,category,business_email,location")
    .eq("owner_id", uid)
    .maybeSingle();

  if (bizReadErr) return;

  let businessId = biz?.id ?? null;

  if (!businessId) {
    const { data: inserted, error: insErr } = await client
      .from("businesses")
      .insert({ owner_id: uid, ...CANONICAL_BUSINESS })
      .select("id")
      .single();
    if (insErr || !inserted?.id) return;
    businessId = inserted.id;
  } else if (biz && isLegacyAccountStub(biz)) {
    await client.from("businesses").update({ ...CANONICAL_BUSINESS }).eq("id", businessId);
  }

  if (!businessId) return;

  let locationId: string | null = null;
  try {
    const { data: existingLoc } = await client
      .from("business_locations")
      .select("id")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingLoc?.id) {
      locationId = existingLoc.id;
      await client.from("business_locations").update({ ...DEMO_LOCATION }).eq("id", locationId);
    } else {
      const { data: insertedLoc } = await client
        .from("business_locations")
        .insert({ business_id: businessId, ...DEMO_LOCATION })
        .select("id")
        .maybeSingle();
      locationId = insertedLoc?.id ?? null;
    }
  } catch {
    // Older schema may not have business_locations yet; continue without location_id.
  }

  try {
    const { data: existingItems } = await client
      .from("business_menu_items")
      .select("id,name")
      .eq("business_id", businessId);
    const byName = new Map((existingItems ?? []).map((row) => [String(row.name), String(row.id)]));
    for (let i = 0; i < DEMO_MENU_ITEMS.length; i += 1) {
      const item = DEMO_MENU_ITEMS[i];
      const payload = {
        business_id: businessId,
        name: item.name,
        category: item.category,
        price_text: item.price_text,
        description: item.description,
        sort_order: i + 1,
        source: "manual",
        archived_at: null,
      };
      const existingId = byName.get(item.name);
      if (existingId) {
        await client.from("business_menu_items").update(payload).eq("id", existingId);
      } else {
        await client.from("business_menu_items").insert(payload);
      }
    }
  } catch {
    // Menu library table may not exist in older local environments.
  }

  const { data: existingProfileByUser } = await client
    .from("business_profiles")
    .select("subscription_status,subscription_tier,trial_ends_at,current_period_ends_at")
    .eq("user_id", uid)
    .maybeSingle();
  const { data: existingProfileByOwner } = await client
    .from("business_profiles")
    .select("subscription_status,subscription_tier,trial_ends_at,current_period_ends_at")
    .eq("owner_id", uid)
    .maybeSingle();
  const existingProfile = existingProfileByUser ?? existingProfileByOwner ?? null;

  const billingDefaults: Record<string, unknown> = {};
  if (!existingProfile?.subscription_status) billingDefaults.subscription_status = "trial";
  if (!existingProfile?.subscription_tier) billingDefaults.subscription_tier = "pro";
  if (!existingProfile?.trial_ends_at) billingDefaults.trial_ends_at = trialEndsAtIso;
  if (!existingProfile?.current_period_ends_at) {
    billingDefaults.current_period_ends_at = String(existingProfile?.trial_ends_at ?? trialEndsAtIso);
  }

  // Keep demo business mode unblocked in new gating: ensure a complete business_profiles row.
  const profilePayloadByUser = {
    user_id: uid,
    ...CANONICAL_BUSINESS_PROFILE,
    ...billingDefaults,
  };
  const upsertByUser = await client.from("business_profiles").upsert(profilePayloadByUser, { onConflict: "user_id" });
  if (upsertByUser.error) {
    const profilePayloadByOwner = {
      owner_id: uid,
      ...CANONICAL_BUSINESS_PROFILE,
      ...billingDefaults,
    };
    await client.from("business_profiles").upsert(profilePayloadByOwner, { onConflict: "owner_id" });
  }

  await client
    .from("profiles")
    .upsert({ id: uid, app_tab_mode: "business", updated_at: new Date().toISOString() }, { onConflict: "id" });

  const now = new Date();
  await client.from("deals").delete().eq("business_id", businessId).in("title", SEEDED_DEAL_TITLES);
  const dealRows = buildSeedDealRows(now, businessId, locationId);
  const { data: insertedDeals, error: dealsInsertErr } = await client
    .from("deals")
    .insert(dealRows)
    .select("id,title,start_time,end_time");
  if (dealsInsertErr) return;
  const seededDeals = insertedDeals ?? [];
  if (seededDeals.length === 0) return;

  const { count: hasSeedClaims } = await client
    .from("deal_claims")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid)
    .in("deal_id", seededDeals.map((d) => d.id));

  if (!hasSeedClaims) {
    // Claims must be created via the `claim-deal` edge function so claim rules / expiration semantics are enforced.
    // For demo: redeem the first two claims right away so the third claim can exist concurrently.
    const dealsForSeed = seededDeals.slice(0, 3);
    for (let i = 0; i < dealsForSeed.length; i += 1) {
      const d = dealsForSeed[i];

      const { data: claimOut, error: claimErr } = await client.functions.invoke("claim-deal", {
        body: { deal_id: d.id },
      });

      if (claimErr || !claimOut || typeof claimOut !== "object") {
        console.error("[demo-preview-seed] claim-deal failed:", claimErr);
        return;
      }

      if (i < 2) {
        const shortCode = (claimOut as { short_code?: string | null }).short_code ?? null;
        const token = (claimOut as { token?: string | null }).token ?? null;

        const { error: redeemErr } = await client.functions.invoke("redeem-token", {
          body: shortCode ? { short_code: shortCode } : { token },
        });

        if (redeemErr) {
          console.error("[demo-preview-seed] redeem-token failed:", redeemErr);
          return;
        }
      }
    }
  }

  const { count: existingSeedAnalytics } = await client
    .from("app_analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .contains("context", { seed: DEMO_ANALYTICS_EVENT_SEED });

  if (!existingSeedAnalytics) {
    const firstDeal = seededDeals[0]?.id ?? null;
    const secondDeal = seededDeals[1]?.id ?? firstDeal;
    const analyticsRows = [
      { event_name: "deal_viewed", deal_id: firstDeal, n: 36 },
      { event_name: "deal_opened", deal_id: firstDeal, n: 18 },
      { event_name: "deal_viewed", deal_id: secondDeal, n: 24 },
      { event_name: "deal_opened", deal_id: secondDeal, n: 11 },
      { event_name: "deal_claimed", deal_id: firstDeal, n: 5 },
      { event_name: "redeem_completed", deal_id: firstDeal, n: 2 },
    ].flatMap((row) =>
      Array.from({ length: row.n }, (_, i) => ({
        event_name: row.event_name,
        user_id: uid,
        business_id: businessId,
        deal_id: row.deal_id,
        context: {
          source: "demo_seed",
          seed: DEMO_ANALYTICS_EVENT_SEED,
          ordinal: i + 1,
        },
        app_version: "demo-seed",
        device_platform: "demo",
      })),
    );
    await client.from("app_analytics_events").insert(analyticsRows);
  }
}
