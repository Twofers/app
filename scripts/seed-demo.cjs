/**
 * Preview/dev: create demo@demo.com if missing, upsert Demo Roasted Bean Coffee, replace sample deals.
 * Requires service role (same as Supabase SQL Editor power).
 *
 * Usage:
 *   set SUPABASE_URL=https://xxx.supabase.co
 *   set SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   npm run seed:demo
 */

/* eslint-disable no-console */
const { createClient } = require("@supabase/supabase-js");

const DEMO_EMAIL = "demo@demo.com";
const DEMO_PASSWORD = "demo12345";
const PREFERRED_BID = "a0000000-0000-4000-8000-00000000c0de";

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

const DEALS = [
  {
    title: "2-for-1 oat milk lattes",
    description: "Bring a friend — two lattes for the price of one. Buy one oat milk latte, get one free.",
    price: 6.5,
    days: 14,
    max_claims: 200,
    poster_url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80",
  },
  {
    title: "Buy one pastry, get one free before 10am",
    description: "Any pastry with a medium hot coffee — second pastry free every morning.",
    price: 4.25,
    days: 10,
    max_claims: 150,
    poster_url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80",
  },
  {
    title: "BOGO cold brew — second one free",
    description: "Two single-origin cold brews for the price of one. Weekend special.",
    price: 8.0,
    days: 21,
    max_claims: 80,
    poster_url: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=1200&q=80",
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

  const { error: delErr } = await supabase.from("deals").delete().eq("business_id", bid);
  if (delErr) throw delErr;

  const now = new Date();
  const rows = DEALS.map((d) => ({
    business_id: bid,
    title: d.title,
    description: d.description,
    price: d.price,
    start_time: now.toISOString(),
    end_time: new Date(now.getTime() + d.days * 24 * 60 * 60 * 1000).toISOString(),
    claim_cutoff_buffer_minutes: 30,
    max_claims: d.max_claims,
    is_active: true,
    poster_url: d.poster_url,
    poster_storage_path: null,
    quality_tier: "acceptable",
  }));

  const { error: dealErr } = await supabase.from("deals").insert(rows);
  if (dealErr) throw dealErr;

  console.log("Seeded", rows.length, "deals on business", bid);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
