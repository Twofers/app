/**
 * Preview/dev: create demo@demo.com if missing, then seed a polished Dallas demo business.
 * Includes location, menu library, mixed-status deals, billing trial defaults, and analytics data.
 * Requires service role (same as Supabase SQL Editor power).
 */

/* eslint-disable no-console */
const { createClient } = require("@supabase/supabase-js");

const DEMO_EMAIL = "demo@demo.com";
const DEMO_PASSWORD = "demo12345";
const PREFERRED_BID = "a0000000-0000-4000-8000-00000000c0de";
const ANALYTICS_SEED = "demo_business_seed_v2";

const BUSINESS = {
  name: "Demo Roasted Bean Coffee",
  address: "1234 Commerce St",
  location: "Dallas, TX",
  latitude: 32.7831,
  longitude: -96.8067,
  phone: "(214) 555-0100",
  hours_text: "Mon–Fri 7:00–19:00 · Sat–Sun 8:00–18:00",
  short_description: "Neighborhood espresso bar for Twofer preview testers.",
  category: "Coffee shop",
  contact_name: "Demo Owner",
  business_email: "hello@demo.twofer.app",
};

const LOCATION = {
  name: "Downtown Dallas Cafe",
  address: "1234 Commerce St, Dallas, TX 75202",
  phone: "(214) 555-0100",
  lat: 32.7831,
  lng: -96.8067,
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
    title: "2-for-1 oat milk lattes (live)",
    description: "Buy one oat milk latte, get one free for your coworker.",
    price: 6.5,
    max_claims: 220,
    poster_url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80",
    kind: "live",
    durationDays: 20,
  },
  {
    title: "Morning pastry pair + drip (live)",
    description: "Two pastries and two medium drips for one combo price before noon.",
    price: 7.5,
    max_claims: 180,
    poster_url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80",
    kind: "live",
    durationDays: 16,
  },
  {
    title: "After-school iced latte happy hour (scheduled)",
    description: "Starts this week: buy one iced latte, get a second 50% off.",
    price: 6.0,
    max_claims: 140,
    poster_url: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80",
    kind: "scheduled",
    startOffsetDays: 2,
    endOffsetDays: 12,
  },
  {
    title: "Weekday 2-for-1 cold brew window (recurring)",
    description: "Recurring Mon-Fri 2:00-5:00 PM cold brew 2-for-1 special.",
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
    title: "Saturday bakery box bogo (recurring)",
    description: "Every Saturday morning: buy one pastry box, get one free.",
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
  const { data: profileByUser } = await supabase
    .from("business_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileByUser?.id) {
    const { error: pErr } = await supabase
      .from("business_profiles")
      .update({
        name: BUSINESS.name,
        address: BUSINESS.address,
        category: "Coffee Shop",
        setup_completed: true,
        subscription_status: "trial",
        subscription_tier: "pro",
        trial_ends_at: trialEndsAtIso,
        current_period_ends_at: trialEndsAtIso,
      })
      .eq("id", profileByUser.id);
    if (pErr) throw pErr;
  } else {
    const { error: upUserErr } = await supabase.from("business_profiles").upsert(
      {
        user_id: userId,
        name: BUSINESS.name,
        address: BUSINESS.address,
        category: "Coffee Shop",
        setup_completed: true,
        subscription_status: "trial",
        subscription_tier: "pro",
        trial_ends_at: trialEndsAtIso,
        current_period_ends_at: trialEndsAtIso,
      },
      { onConflict: "user_id" },
    );
    if (upUserErr) {
      const { error: upOwnerErr } = await supabase.from("business_profiles").upsert(
        {
          owner_id: userId,
          name: BUSINESS.name,
          address: BUSINESS.address,
          category: "Coffee Shop",
          setup_completed: true,
          subscription_status: "trial",
          subscription_tier: "pro",
          trial_ends_at: trialEndsAtIso,
          current_period_ends_at: trialEndsAtIso,
        },
        { onConflict: "owner_id" },
      );
      if (upOwnerErr) throw upOwnerErr;
    }
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

  const { error: delErr } = await supabase.from("deals").delete().eq("business_id", bid).in("title", DEALS.map((d) => d.title));
  if (delErr) throw delErr;

  const now = new Date();
  const rows = DEALS.map((d) => ({
    business_id: bid,
    location_id: locationId,
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

  const { data: insertedDeals, error: dealErr } = await supabase.from("deals").insert(rows).select("id,title,end_time");
  if (dealErr) throw dealErr;

  const claimSeedRows = (insertedDeals || []).slice(0, 3).map((d, i) => ({
    deal_id: d.id,
    user_id: userId,
    token: `demo${Date.now()}${i}${Math.random().toString(36).slice(2, 8)}`.slice(0, 32),
    expires_at: new Date(new Date(d.end_time).getTime() - 15 * 60 * 1000).toISOString(),
    redeemed_at: i < 2 ? new Date(now.getTime() - (i + 1) * 3 * 60 * 60 * 1000).toISOString() : null,
    claim_status: i < 2 ? "redeemed" : "active",
    redeem_method: i < 2 ? "visual" : null,
    grace_period_minutes: 10,
    acquisition_source: "demo_seed",
    device_platform_at_claim: "demo",
  }));
  if (claimSeedRows.length > 0) {
    const { error: clearClaimsErr } = await supabase.from("deal_claims").delete().eq("user_id", userId).in("deal_id", claimSeedRows.map((r) => r.deal_id));
    if (clearClaimsErr) throw clearClaimsErr;
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
      device_platform: "demo",
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
