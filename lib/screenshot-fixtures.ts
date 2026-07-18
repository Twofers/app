import { SCREENSHOT_USER_ID } from "@/lib/screenshot-mode";

/**
 * Deterministic synthetic data for App Store screenshots (see screenshot-mode.ts).
 *
 * Everything here is fake and safe to publish: invented businesses, invented
 * deals, an invented redemption code, and a synthetic shopper account. There is
 * NO real user data, NO real card numbers, and NO real account.
 *
 * ── TUNING NOTE ──────────────────────────────────────────────────────────────
 * The column names below are best-effort. Each screen queries specific columns;
 * when you run the pipeline on macOS, if a screen renders blank, capture the
 * request path from the Metro logs and add / rename the fields the screen reads
 * to the matching fixture. The resolver already returns an empty array for any
 * unmatched table, so a mismatch degrades to "empty screen", never a crash.
 */

const BIZ_1 = "00000000-0000-4000-8000-0000000000a1";
const BIZ_2 = "00000000-0000-4000-8000-0000000000a2";
const BIZ_3 = "00000000-0000-4000-8000-0000000000a3";

const DEAL_1 = "00000000-0000-4000-8000-0000000000d1";
const DEAL_2 = "00000000-0000-4000-8000-0000000000d2";
const DEAL_3 = "00000000-0000-4000-8000-0000000000d3";
const DEAL_4 = "00000000-0000-4000-8000-0000000000d4";
const CLAIM_1 = "00000000-0000-4000-8000-0000000000c1";

const nowMs = Date.now();
const inDays = (d: number) => new Date(nowMs + d * 86_400_000).toISOString();
const epochIso = new Date(0).toISOString();

const businesses = [
  {
    id: BIZ_1,
    name: "Bluebird Coffee Co.",
    category: "Coffee & Tea",
    city: "Dallas",
    state: "TX",
    zip_code: "75201",
    latitude: 32.7831,
    longitude: -96.8067,
    logo_url: null,
    description: "Neighborhood roaster on Elm Street.",
  },
  {
    id: BIZ_2,
    name: "Ferndale Pizza Kitchen",
    category: "Restaurant",
    city: "Dallas",
    state: "TX",
    zip_code: "75204",
    latitude: 32.8017,
    longitude: -96.7846,
    logo_url: null,
    description: "Wood-fired pies and salads.",
  },
  {
    id: BIZ_3,
    name: "Maple & Main Bakery",
    category: "Bakery",
    city: "Dallas",
    state: "TX",
    zip_code: "75226",
    latitude: 32.7845,
    longitude: -96.7712,
    logo_url: null,
    description: "Fresh sourdough daily.",
  },
];

const businessById = new Map(businesses.map((business) => [business.id, business]));

const deals = [
  {
    id: DEAL_1,
    business_id: BIZ_1,
    title: "Buy one latte, get one free",
    description: "Bring a friend — two lattes for the price of one, every weekday morning.",
    status: "active",
    starts_at: inDays(-2),
    ends_at: inDays(5),
    start_time: inDays(-2),
    end_time: inDays(5),
    is_active: true,
    title_en: "Buy one latte, get one free",
    description_en: "Bring a friend - two lattes for the price of one, every weekday morning.",
    image_url: null,
    poster_url: null,
    poster_storage_path: null,
    discount_label: "2 for 1",
    price: null,
    max_claims: 100,
    timezone: "America/Chicago",
    businesses: businessById.get(BIZ_1),
  },
  {
    id: DEAL_2,
    business_id: BIZ_2,
    title: "Free garlic knots with any large pizza",
    description: "A basket of house garlic knots on us with every large pie.",
    status: "active",
    starts_at: inDays(-1),
    ends_at: inDays(2),
    start_time: inDays(-1),
    end_time: inDays(2),
    is_active: true,
    title_en: "Free garlic knots with any large pizza",
    description_en: "A basket of house garlic knots on us with every large pie.",
    image_url: null,
    poster_url: null,
    poster_storage_path: null,
    discount_label: "Free side",
    price: null,
    max_claims: 100,
    timezone: "America/Chicago",
    businesses: businessById.get(BIZ_2),
  },
  {
    id: DEAL_3,
    business_id: BIZ_3,
    title: "Half-price sourdough after 4pm",
    description: "Same-day loaves are 50% off from 4pm until we sell out.",
    status: "active",
    starts_at: inDays(-3),
    ends_at: inDays(10),
    start_time: inDays(-3),
    end_time: inDays(10),
    is_active: true,
    title_en: "Half-price sourdough after 4pm",
    description_en: "Same-day loaves are 50% off from 4pm until we sell out.",
    image_url: null,
    poster_url: null,
    poster_storage_path: null,
    discount_label: "50% off",
    price: null,
    max_claims: 100,
    timezone: "America/Chicago",
    businesses: businessById.get(BIZ_3),
  },
  {
    id: DEAL_4,
    business_id: BIZ_1,
    title: "$2 off any pour-over",
    description: "Single-origin pour-overs, two dollars off all day Sunday.",
    status: "active",
    starts_at: inDays(-1),
    ends_at: inDays(7),
    start_time: inDays(-1),
    end_time: inDays(7),
    is_active: true,
    title_en: "$2 off any pour-over",
    description_en: "Single-origin pour-overs, two dollars off all day Sunday.",
    image_url: null,
    poster_url: null,
    poster_storage_path: null,
    discount_label: "$2 off",
    price: null,
    max_claims: 100,
    timezone: "America/Chicago",
    businesses: businessById.get(BIZ_1),
  },
];

const favorites = [{ user_id: SCREENSHOT_USER_ID, business_id: BIZ_1, created_at: epochIso }];

const profiles = [{ id: SCREENSHOT_USER_ID, role: "customer", created_at: epochIso }];

const consumerProfiles = [
  {
    id: SCREENSHOT_USER_ID,
    user_id: SCREENSHOT_USER_ID,
    display_name: "Demo Shopper",
    zip_code: "75201",
    deal_alerts_enabled: true,
    onboarding_completed: true,
  },
];

const claims = [
  {
    id: CLAIM_1,
    deal_id: DEAL_1,
    user_id: SCREENSHOT_USER_ID,
    business_id: BIZ_1,
    status: "redeemed",
    redemption_code: "DEMO-2FOR1-0001",
    claimed_at: inDays(-1),
    redeemed_at: inDays(-1),
  },
];

/** table name (as it appears after /rest/v1/) → fixture rows */
const TABLES: Record<string, Record<string, unknown>[]> = {
  businesses,
  deals,
  favorites,
  profiles,
  consumer_profiles: consumerProfiles,
  claims,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wantsSingleObject(headers: unknown): boolean {
  if (!headers) return false;
  const accept =
    (headers as { get?: (k: string) => string | null }).get?.("Accept") ??
    (typeof headers === "object" ? (headers as Record<string, string>)["Accept"] : null);
  return typeof accept === "string" && accept.includes("pgrst.object");
}

/**
 * Returns a canned Response for a Supabase request when in screenshot mode, or
 * null to let the caller fall through (should not normally happen in screenshot
 * mode — the resolver aims to answer everything so the app stays fully offline).
 */
export function resolveScreenshotResponse(
  urlText: string,
  method: string,
  headers?: unknown,
  _body?: unknown,
): Response | null {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }
  const path = url.pathname;

  // Auth: hand back the synthetic session / user, accept sign-out.
  if (path.includes("/auth/v1/token")) {
    return jsonResponse({
      access_token: "screenshot-mode-fake-access-token",
      refresh_token: "screenshot-mode-fake-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: SCREENSHOT_USER_ID, email: "demo.shopper@screenshots.twoferapp.com" },
    });
  }
  if (path.includes("/auth/v1/user")) {
    return jsonResponse({ id: SCREENSHOT_USER_ID, email: "demo.shopper@screenshots.twoferapp.com" });
  }
  if (path.includes("/auth/v1/logout")) {
    return jsonResponse({}, 204);
  }

  // Redemption edge functions: report success with the synthetic claim.
  if (path.includes("/functions/v1/redeem-token") || path.includes("/functions/v1/complete-visual-redeem")) {
    return jsonResponse({ ok: true, claim_id: CLAIM_1, deal_id: DEAL_1, redemption_code: "DEMO-2FOR1-0001" });
  }

  // REST table reads.
  const restMatch = path.match(/\/rest\/v1\/([^/?]+)/);
  if (restMatch) {
    const table = restMatch[1]!;
    const rows = TABLES[table] ?? [];
    if (method === "GET") {
      return wantsSingleObject(headers) ? jsonResponse(rows[0] ?? null) : jsonResponse(rows);
    }
    // Writes (favorite toggles, profile updates) succeed as no-ops.
    return wantsSingleObject(headers) ? jsonResponse(rows[0] ?? {}) : jsonResponse(rows);
  }

  // Anything else (analytics ingest, storage) — succeed quietly, stay offline.
  return jsonResponse({}, 200);
}
