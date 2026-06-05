/**
 * Preview/dev: create demo@demo.com if missing, then seed a polished DFW cafe demo.
 * Includes location, menu library, mixed-status deals, billing trial defaults, and analytics data.
 * Requires service role (same as Supabase SQL Editor power).
 */

/* eslint-disable no-console */
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("node:crypto");

const DEMO_EMAIL = "demo@demo.com";
const DEMO_PASSWORD = "demo12345";
const PREFERRED_BID = "a0000000-0000-4000-8000-00000000c0de";
const ANALYTICS_SEED = "demo_business_seed_v2";

const BUSINESS = {
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
};

const LOCATION = {
  name: "Grapevine Main Street",
  address: "120 S Main St, Grapevine, TX 76051",
  phone: "(817) 555-0148",
  lat: 32.9407,
  lng: -97.0781,
};

const MENU_ITEMS = [
  { name: "Oat Milk Latte", category: "Coffee", price_text: "$6.50", description: "Double shot with house oat milk." },
  { name: "Vanilla Cortado", category: "Coffee", price_text: "$5.25", description: "Short milk-forward espresso drink." },
  { name: "Single-Origin Cold Brew", category: "Cold Coffee", price_text: "$5.75", description: "Rotating seasonal single-origin brew." },
  { name: "Matcha Latte", category: "Tea", price_text: "$6.00", description: "Ceremonial matcha with choice of milk." },
  { name: "Butter Croissant", category: "Pastry", price_text: "$4.25", description: "Flaky all-butter morning pastry." },
  { name: "Blueberry Muffin", category: "Pastry", price_text: "$4.50", description: "Baked in-house with lemon sugar top." },
];

const DEALS = [
  {
    title: "Buy One Latte, Get One Free",
    description: "Bring a friend: buy any handcrafted latte and get a second latte free.",
    price: 6.5,
    max_claims: 220,
    poster_url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80",
    kind: "live",
    durationDays: 20,
  },
  {
    title: "2-for-1 Pastry Pair Before Noon",
    description: "Buy one fresh-baked pastry before noon and get a second pastry free.",
    price: 4.75,
    max_claims: 180,
    poster_url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80",
    kind: "live",
    durationDays: 16,
  },
  {
    title: "BOGO Iced Tea Launch Special",
    description: "Starts this week: buy one house iced tea and get a second free.",
    price: 4.5,
    max_claims: 140,
    poster_url: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80",
    kind: "scheduled",
    startOffsetDays: 2,
    endOffsetDays: 12,
  },
  {
    title: "Weekday Cold Brew 2-for-1",
    description: "Monday-Friday from 2-5 PM, buy one cold brew and get one free.",
    price: 5.75,
    max_claims: 260,
    poster_url: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=1200&q=80",
    kind: "recurring",
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
    kind: "recurring",
    days_of_week: [6],
    window_start_minutes: 8 * 60,
    window_end_minutes: 12 * 60,
    durationDays: 45,
  },
];

const LEGACY_DEAL_TITLES = [
  "2-for-1 oat milk lattes (live)",
  "Morning pastry pair + drip (live)",
  "After-school iced latte happy hour (scheduled)",
  "Weekday 2-for-1 cold brew window (recurring)",
  "Saturday bakery box bogo (recurring)",
  "2-for-1 Latte Pair",
];
const LEGACY_DEAL_TITLE_PREFIXES = [
  "BOGO: 2-for-1 Cold Brew Pair",
];

async function findDemoUserId(adminClient) {
  for (let page = 1; page <= 30; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === DEMO_EMAIL);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (project Settings → API).");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId = await findDemoUserId(supabase);
  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("Created Auth user:", DEMO_EMAIL);
  } else {
    console.log("Found Auth user:", DEMO_EMAIL, userId);
  }

  const { data: existing, error: exErr } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", userId)
    .maybeSingle();
  if (exErr) throw exErr;

  let bid = existing?.id ?? null;

  if (!bid) {
    const { data: ins, error: insErr } = await supabase
      .from("businesses")
      .insert({ id: PREFERRED_BID, owner_id: userId, ...BUSINESS })
      .select("id")
      .single();
    if (insErr) throw insErr;
    bid = ins.id;
    console.log("Inserted business", bid);
  } else {
    const { error: upErr } = await supabase.from("businesses").update({ ...BUSINESS }).eq("id", bid);
    if (upErr) throw upErr;
    console.log("Updated business", bid);
  }

  const trialEndsAtIso = new Date(Date.now() + 30 * 86400000).toISOString();
  const profilePayload = {
    name: BUSINESS.name,
    address: BUSINESS.address,
    category: BUSINESS.category,
    setup_completed: true,
    subscription_status: "trial",
    subscription_tier: "pro",
    trial_ends_at: trialEndsAtIso,
    current_period_ends_at: trialEndsAtIso,
  };
  const { data: profileByUser } = await supabase
    .from("business_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileByUser?.id) {
    const { error: pErr } = await supabase
      .from("business_profiles")
      .update(profilePayload)
      .eq("id", profileByUser.id);
    if (pErr) throw pErr;
    console.log("Updated business_profiles", profileByUser.id);
  } else {
    const { error: insProfileErr } = await supabase.from("business_profiles").upsert(
      { user_id: userId, ...profilePayload },
      { onConflict: "user_id" },
    );
    if (insProfileErr) throw insProfileErr;
    console.log("Inserted business_profiles for user", userId);
  }

  let locationId = null;
  try {
    const { data: existingLoc, error: existingLocErr } = await supabase
      .from("business_locations")
      .select("id")
      .eq("business_id", bid)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existingLocErr) throw existingLocErr;
    if (existingLoc?.id) {
      locationId = existingLoc.id;
      const { error: upLocErr } = await supabase.from("business_locations").update({ ...LOCATION }).eq("id", locationId);
      if (upLocErr) throw upLocErr;
    } else {
      const { data: insertedLoc, error: insLocErr } = await supabase
        .from("business_locations")
        .insert({ business_id: bid, ...LOCATION })
        .select("id")
        .single();
      if (insLocErr) throw insLocErr;
      locationId = insertedLoc.id;
    }
  } catch {
    console.log("business_locations unavailable, skipping location seed.");
  }

  try {
    const { data: existingMenu, error: menuReadErr } = await supabase
      .from("business_menu_items")
      .select("id,name")
      .eq("business_id", bid);
    if (menuReadErr) throw menuReadErr;
    const nameToId = new Map((existingMenu || []).map((row) => [String(row.name), row.id]));
    for (let i = 0; i < MENU_ITEMS.length; i += 1) {
      const item = MENU_ITEMS[i];
      const payload = {
        business_id: bid,
        name: item.name,
        category: item.category,
        price_text: item.price_text,
        description: item.description,
        sort_order: i + 1,
        source: "manual",
        archived_at: null,
      };
      if (nameToId.has(item.name)) {
        const { error: upMenuErr } = await supabase
          .from("business_menu_items")
          .update(payload)
          .eq("id", nameToId.get(item.name));
        if (upMenuErr) throw upMenuErr;
      } else {
        const { error: insMenuErr } = await supabase.from("business_menu_items").insert(payload);
        if (insMenuErr) throw insMenuErr;
      }
    }
  } catch {
    console.log("business_menu_items unavailable, skipping menu seed.");
  }

  const dealTitlesToReplace = Array.from(new Set([...DEALS.map((d) => d.title), ...LEGACY_DEAL_TITLES]));
  const { error: delErr } = await supabase.from("deals").delete().eq("business_id", bid).in("title", dealTitlesToReplace);
  if (delErr) throw delErr;
  for (const prefix of LEGACY_DEAL_TITLE_PREFIXES) {
    const { error: prefixDelErr } = await supabase.from("deals").delete().eq("business_id", bid).like("title", `${prefix}%`);
    if (prefixDelErr) throw prefixDelErr;
  }

  /**
   * Insert deals, retrying without location_id if that column is absent from the
   * PostgREST schema cache (PGRST204 on hosted projects that don't expose it).
   */
  async function insertDealsWithFallback(client, dealRows) {
    const { data, error } = await client.from("deals").insert(dealRows).select("id,title,end_time");
    if (!error) return { data, error };
    if (error.code === "PGRST204" && error.message && error.message.includes("location_id")) {
      console.log("location_id not in schema cache - retrying deal insert without it.");
      const stripped = dealRows.map((r) => {
        const copy = { ...r };
        delete copy.location_id;
        return copy;
      });
      return client.from("deals").insert(stripped).select("id,title,end_time");
    }
    return { data, error };
  }

  const now = new Date();
  const rows = DEALS.map((d) => ({
    business_id: bid,
    ...(locationId != null ? { location_id: locationId } : {}),
    title: d.title,
    description: d.description,
    price: d.price,
    start_time:
      d.kind === "scheduled"
        ? new Date(now.getTime() + (d.startOffsetDays || 0) * 24 * 60 * 60 * 1000).toISOString()
        : now.toISOString(),
    end_time:
      d.kind === "scheduled"
        ? new Date(now.getTime() + (d.endOffsetDays || 14) * 24 * 60 * 60 * 1000).toISOString()
        : new Date(now.getTime() + (d.durationDays || 14) * 24 * 60 * 60 * 1000).toISOString(),
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
  }));

  const { data: insertedDeals, error: dealErr } = await insertDealsWithFallback(supabase, rows);
  if (dealErr) throw dealErr;

  // Demo wallet history: two *redeemed* claims, backdated to prior local days.
  // Backdating keeps them as redeemed history in the wallet/dashboard while
  // leaving today free for a fresh claim — the claim-deal guards reject another
  // claim if the user already has an active claim app-wide OR any non-canceled
  // claim on this business *today* (see supabase/functions/claim-deal). We do NOT
  // seed an active claim; the owner-demo proof creates the active ticket live.
  const claimSeedRows = (insertedDeals || []).slice(0, 2).map((d, i) => {
    const claimedAt = new Date(now.getTime() - (i + 1) * 24 * 60 * 60 * 1000); // 1-2 days ago
    return {
      deal_id: d.id,
      user_id: userId,
      // deal_claims.token is a uuid column in prod (claim-deal edge fn uses
      // crypto.randomUUID()); a non-uuid string here fails with 22P02.
      token: randomUUID(),
      created_at: claimedAt.toISOString(),
      expires_at: new Date(claimedAt.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      redeemed_at: new Date(claimedAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      claim_status: "redeemed",
      redeem_method: "visual",
      grace_period_minutes: 10,
      acquisition_source: "demo_seed",
      device_platform_at_claim: "demo",
    };
  });
  // Clear ALL of the demo user's claims on canonical deals first so a stale
  // active claim from a prior smoke can't block the next fresh-claim proof.
  const seededDealIds = (insertedDeals || []).map((d) => d.id);
  if (seededDealIds.length > 0) {
    const { error: clearClaimsErr } = await supabase.from("deal_claims").delete().eq("user_id", userId).in("deal_id", seededDealIds);
    if (clearClaimsErr) throw clearClaimsErr;
  }
  if (claimSeedRows.length > 0) {
    const { error: claimErr } = await supabase.from("deal_claims").insert(claimSeedRows);
    if (claimErr) throw claimErr;
  }

  const { error: clearAnalyticsErr } = await supabase
    .from("app_analytics_events")
    .delete()
    .eq("business_id", bid)
    .contains("context", { seed: ANALYTICS_SEED });
  if (clearAnalyticsErr) throw clearAnalyticsErr;

  const firstDeal = insertedDeals?.[0]?.id || null;
  const secondDeal = insertedDeals?.[1]?.id || firstDeal;
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
      user_id: userId,
      business_id: bid,
      deal_id: row.deal_id,
      context: { source: "demo_seed", seed: ANALYTICS_SEED, ordinal: i + 1 },
      app_version: "demo-seed",
      // deal_viewed has a unique index on (user_id, deal_id, device_platform, UTC
      // day) -- uq_app_analytics_deal_viewed_daily. Give each seeded impression a
      // distinct synthetic device so the same-day rows don't collide (23505); other
      // event types are unconstrained and keep the plain "demo" platform.
      device_platform: row.event_name === "deal_viewed" ? `demo-${i + 1}` : "demo",
    })),
  );
  const { error: analyticsErr } = await supabase.from("app_analytics_events").insert(analyticsRows);
  if (analyticsErr) throw analyticsErr;

  console.log("Seeded polished demo data on business", bid);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
