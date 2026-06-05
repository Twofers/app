import type { SupabaseClient } from "@supabase/supabase-js";

import { DEMO_PREVIEW_EMAIL, isDemoPreviewAccountEmail } from "@/lib/demo-account";

/** Matches `supabase/seed_demo_coffee_business.sql` (canonical preview business + deals). */
const CANONICAL_BUSINESS = {
  name: "Cedar & Bean Cafe",
  address: "120 S Main St",
  location: "Grapevine, TX",
  latitude: 32.9407,
  longitude: -97.0781,
  phone: "(817) 555-0148",
  hours_text: "Mon-Fri 7 AM - 7 PM | Sat-Sun 8 AM - 6 PM",
  short_description: "Neighborhood cafe serving espresso, scratch pastries, and quick lunch plates in downtown Grapevine.",
  category: "Cafe & Bakery",
  contact_name: "Maya Patel",
  business_email: "hello@cedarbean.cafe",
} as const;

const CANONICAL_BUSINESS_PROFILE = {
  name: "Cedar & Bean Cafe",
  address: "120 S Main St",
  category: "Cafe & Bakery",
  setup_completed: true,
} as const;

const DEMO_LOCATION = {
  name: "Grapevine Main Street",
  address: "120 S Main St, Grapevine, TX 76051",
  phone: "(817) 555-0148",
  lat: 32.9407,
  lng: -97.0781,
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
    title: "Buy One Latte, Get One Free",
    description: "Bring a friend: buy any handcrafted latte and get a second latte free.",
    price: 6.5,
    max_claims: 220,
    poster_url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80",
    kind: "live" as const,
    durationDays: 20,
  },
  {
    title: "2-for-1 Pastry Pair Before Noon",
    description: "Buy one fresh-baked pastry before noon and get a second pastry free.",
    price: 4.75,
    max_claims: 180,
    poster_url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80",
    kind: "live" as const,
    durationDays: 16,
  },
  {
    title: "BOGO Iced Tea Launch Special",
    description: "Starts this week: buy one house iced tea and get a second free.",
    price: 4.5,
    max_claims: 140,
    poster_url: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80",
    kind: "scheduled" as const,
    startOffsetDays: 2,
    endOffsetDays: 12,
  },
  {
    title: "Weekday Cold Brew 2-for-1",
    description: "Monday-Friday from 2-5 PM, buy one cold brew and get one free.",
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
    title: "Saturday Bakery Box BOGO",
    description: "Every Saturday morning, buy one pastry box and get a second box free.",
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

const LEGACY_BUSINESS_NAMES = new Set(["Demo Roasted Bean Coffee", "Your Coffee Shop"]);
const LEGACY_DEAL_TITLES = [
  "2-for-1 oat milk lattes (live)",
  "Morning pastry pair + drip (live)",
  "After-school iced latte happy hour (scheduled)",
  "Weekday 2-for-1 cold brew window (recurring)",
  "Saturday bakery box bogo (recurring)",
  "2-for-1 Latte Pair",
] as const;
const LEGACY_DEAL_TITLE_PREFIXES = [
  "BOGO: 2-for-1 Cold Brew Pair",
] as const;
const SEEDED_DEAL_TITLES = Array.from(new Set([...DEMO_DEALS.map((d) => d.title), ...LEGACY_DEAL_TITLES]));
const DEMO_ANALYTICS_EVENT_SEED = "demo_business_seed_v2";

function isLegacyAccountStub(row: {
  name: string | null;
  category: string | null;
  business_email: string | null;
  location: string | null;
}): boolean {
  if (row.name && LEGACY_BUSINESS_NAMES.has(row.name.trim())) return true;
  if (row.category?.trim() === "Demo") return true;
  if (row.business_email?.trim().toLowerCase() === "hello@demo.twofer.app") {
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
    .select("id,name,category,business_email,location")
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
  for (const prefix of LEGACY_DEAL_TITLE_PREFIXES) {
    await client.from("deals").delete().eq("business_id", businessId).like("title", `${prefix}%`);
  }
  const dealRows = buildSeedDealRows(now, businessId, locationId);
  const dealRowsWithoutLocation = dealRows.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    delete copy.location_id;
    return copy;
  });
  // Hosted projects may not expose deals.location_id in the PostgREST schema cache.
  // Skip it when no location row resolved, and retry without it on PGRST204 so the
  // demo-login refresh still seeds deals instead of failing silently.
  let dealsInsert = await client
    .from("deals")
    .insert(locationId != null ? dealRows : dealRowsWithoutLocation)
    .select("id,title,start_time,end_time");
  if (
    dealsInsert.error &&
    dealsInsert.error.code === "PGRST204" &&
    dealsInsert.error.message.includes("location_id")
  ) {
    dealsInsert = await client
      .from("deals")
      .insert(dealRowsWithoutLocation)
      .select("id,title,start_time,end_time");
  }
  const { data: insertedDeals, error: dealsInsertErr } = dealsInsert;
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
        // deal_viewed has a unique index on (user_id, deal_id, device_platform, UTC
        // day) -- uq_app_analytics_deal_viewed_daily. Give each seeded impression a
        // distinct synthetic device so the same-day rows don't collide (23505) and
        // fail the whole batch; other event types keep the plain "demo" platform.
        device_platform: row.event_name === "deal_viewed" ? `demo-${i + 1}` : "demo",
      })),
    );
    await client.from("app_analytics_events").insert(analyticsRows);
  }
}
