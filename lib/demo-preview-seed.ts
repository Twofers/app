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
  hours_text: "Mon–Fri 7:00–19:00 · Sat–Sun 8:00–18:00",
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

const DEMO_DEALS = [
  {
    title: "2-for-1 oat milk lattes",
    description: "Bring a friend — two lattes for the price of one.",
    price: 6.5,
    days: 14,
    max_claims: 200,
    poster_url: "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80",
  },
  {
    title: "Pastry + drip before 10am",
    description: "Any pastry with a medium hot coffee.",
    price: 4.25,
    days: 10,
    max_claims: 150,
    poster_url: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80",
  },
  {
    title: "Weekend cold brew flight",
    description: "Three single-origin cold brew samples.",
    price: 8.0,
    days: 21,
    max_claims: 80,
    poster_url: "https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=1200&q=80",
  },
] as const;

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

/**
 * After demo login, ensures the canonical coffee business and sample deals exist (client-side, RLS-safe).
 * Idempotent: skips when business already has deals; upgrades legacy Account-tab stub rows to canonical profile.
 */
export async function ensureDemoCoffeePreview(client: SupabaseClient): Promise<void> {
  const {
    data: { session },
  } = await client.auth.getSession();
  const email = session?.user?.email;
  if (!session?.user?.id || !isDemoPreviewAccountEmail(email)) return;

  const uid = session.user.id;

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

  // Keep demo business mode unblocked in new gating: ensure a complete business_profiles row.
  const profilePayloadByUser = {
    user_id: uid,
    ...CANONICAL_BUSINESS_PROFILE,
  };
  const upsertByUser = await client.from("business_profiles").upsert(profilePayloadByUser, { onConflict: "user_id" });
  if (upsertByUser.error) {
    const profilePayloadByOwner = {
      owner_id: uid,
      ...CANONICAL_BUSINESS_PROFILE,
    };
    await client.from("business_profiles").upsert(profilePayloadByOwner, { onConflict: "owner_id" });
  }

  const { count, error: countErr } = await client
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);

  if (countErr) return;
  if ((count ?? 0) > 0) return;

  const now = new Date();
  const rows = DEMO_DEALS.map((d) => ({
    business_id: businessId,
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

  await client.from("deals").insert(rows);
}
