import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { getBusinessCapabilities } from "../_shared/business-capabilities.ts";

type BusinessLookupResult = {
  name: string;
  formatted_address: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  category: string;
  hours_text: string;
  website: string;
  place_id: string;
  source: "google_places";
};

type JsonHeaders = Record<string, string>;

type GooglePlace = {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  formattedAddress?: unknown;
  nationalPhoneNumber?: unknown;
  types?: unknown;
  location?: unknown;
  regularOpeningHours?: unknown;
  websiteUri?: unknown;
};

const TYPE_MAP: Record<string, string> = {
  cafe: "Cafe",
  coffee_shop: "Coffee shop",
  bakery: "Bakery",
  restaurant: "Restaurant",
  bar: "Bar",
  meal_delivery: "Delivery",
  meal_takeaway: "Takeaway",
  food: "Food & Drink",
  store: "Store",
};

const DFW_LAT = 32.85;
const DFW_LNG = -96.97;
const SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.types,places.location";
const DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,nationalPhoneNumber,types,location,regularOpeningHours,websiteUri";

function jsonResponse(
  corsHeaders: JsonHeaders,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logLookup(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ tag: "business_lookup", event, ...details }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanPlaceId(value: unknown): string {
  const raw = cleanString(value).replace(/^places\//, "");
  if (!raw || raw.length > 256 || /[\s/]/.test(raw)) return "";
  return raw;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapCategory(types: unknown): string {
  if (!Array.isArray(types)) return "Local business";
  for (const t of types) {
    if (typeof t !== "string") continue;
    const mapped = TYPE_MAP[t];
    if (mapped) return mapped;
  }
  return "Local business";
}

function normalizeGooglePlace(
  place: GooglePlace,
  fallbackName: string,
  explicitPlaceId?: string,
): BusinessLookupResult | null {
  const displayName = asRecord(place.displayName);
  const loc = asRecord(place.location);
  const hours = asRecord(place.regularOpeningHours);
  const weekdayDescriptions = hours?.weekdayDescriptions;
  const placeId = cleanPlaceId(explicitPlaceId) || cleanPlaceId(place.id) || cleanPlaceId(place.name);
  const name = cleanString(displayName?.text) || fallbackName.trim();
  const formattedAddress = cleanString(place.formattedAddress);

  if (!placeId || !name || !formattedAddress) return null;

  return {
    name,
    formatted_address: formattedAddress,
    phone: cleanString(place.nationalPhoneNumber),
    lat: finiteNumber(loc?.latitude),
    lng: finiteNumber(loc?.longitude),
    category: mapCategory(place.types),
    hours_text: Array.isArray(weekdayDescriptions)
      ? weekdayDescriptions.filter((item) => typeof item === "string" && item.trim()).join("\n")
      : "",
    website: cleanString(place.websiteUri),
    place_id: placeId,
    source: "google_places",
  };
}

function googleKeyMissing(corsHeaders: JsonHeaders): Response {
  logLookup("google_places_config_missing");
  return jsonResponse(corsHeaders, 503, {
    error: "Business lookup is temporarily unavailable. Enter details manually or try again later.",
    error_code: "BUSINESS_LOOKUP_CONFIG_MISSING",
  });
}

function googleFailure(
  corsHeaders: JsonHeaders,
  event: string,
  status: number,
  details: Record<string, unknown> = {},
): Response {
  logLookup(event, details);
  return jsonResponse(corsHeaders, status, {
    error: "We could not verify this business. Try another search or enter details manually.",
    error_code: status === 404 ? "BUSINESS_NOT_FOUND" : "BUSINESS_LOOKUP_API_FAILURE",
  });
}

async function searchGooglePlaces(
  corsHeaders: JsonHeaders,
  googleKey: string,
  businessName: string,
  lat: number | null,
  lng: number | null,
): Promise<Response> {
  const biasLat = lat ?? DFW_LAT;
  const biasLng = lng ?? DFW_LNG;

  try {
    const placesRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: businessName,
        locationBias: {
          circle: {
            center: { latitude: biasLat, longitude: biasLng },
            radius: 50000,
          },
        },
        maxResultCount: 5,
      }),
    });

    if (!placesRes.ok) {
      return googleFailure(corsHeaders, "google_places_search_error", 502, {
        status: placesRes.status,
      });
    }

    const placesJson = await placesRes.json();
    const places = Array.isArray(placesJson?.places) ? placesJson.places as GooglePlace[] : [];
    const results = places
      .map((place) => normalizeGooglePlace(place, businessName))
      .filter((row): row is BusinessLookupResult => row !== null);

    if (results.length === 0) {
      logLookup(places.length > 0 ? "google_places_search_unusable_results" : "google_places_search_no_results", {
        candidate_count: places.length,
      });
    }

    return jsonResponse(corsHeaders, 200, { ok: true, results });
  } catch {
    return googleFailure(corsHeaders, "google_places_search_exception", 502, {
      errorCode: "GOOGLE_PLACES_SEARCH_EXCEPTION",
    });
  }
}

async function getGooglePlaceDetails(
  corsHeaders: JsonHeaders,
  googleKey: string,
  placeId: string,
): Promise<Response> {
  try {
    const detailsRes = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": googleKey,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
    });

    if (!detailsRes.ok) {
      return googleFailure(corsHeaders, "google_place_details_error", detailsRes.status === 404 ? 404 : 502, {
        status: detailsRes.status,
      });
    }

    const detailsJson = await detailsRes.json();
    const result = normalizeGooglePlace(detailsJson as GooglePlace, "", placeId);
    if (!result) {
      return googleFailure(corsHeaders, "google_place_details_unusable_result", 404);
    }

    return jsonResponse(corsHeaders, 200, { ok: true, results: [result] });
  } catch {
    return googleFailure(corsHeaders, "google_place_details_exception", 502, {
      errorCode: "GOOGLE_PLACE_DETAILS_EXCEPTION",
    });
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(corsHeaders, 405, { error: "Method not allowed" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse(corsHeaders, 401, { error: "Unauthorized. Please log in." });
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: ownedBusinesses, error: businessError } = await admin
      .from("businesses")
      .select("id")
      .eq("owner_id", user.id)
      .limit(2);
    if (businessError) throw businessError;
    if (!Array.isArray(ownedBusinesses) || ownedBusinesses.length !== 1) {
      return jsonResponse(corsHeaders, 403, {
        error: "Approved business setup is required before business lookup.",
        error_code: "BUSINESS_SETUP_CAPABILITY_REQUIRED",
      });
    }
    const capabilities = await getBusinessCapabilities(admin as any, ownedBusinesses[0].id);
    if (!capabilities.can_use_setup_tools) {
      return jsonResponse(corsHeaders, 403, {
        error: "Business lookup is unavailable for this account.",
        error_code: "BUSINESS_SETUP_CAPABILITY_REQUIRED",
        reason_code: capabilities.reason_code,
      });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(corsHeaders, 400, { error: "Invalid JSON in request body" });
    }

    const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY")?.trim();
    if (!googleKey) return googleKeyMissing(corsHeaders);

    const action = cleanString(body.action) === "details" || cleanString(body.place_id)
      ? "details"
      : "search";

    if (action === "details") {
      const placeId = cleanPlaceId(body.place_id);
      if (!placeId) {
        return jsonResponse(corsHeaders, 400, {
          error: "Missing place_id.",
          error_code: "BUSINESS_LOOKUP_MISSING_PLACE_ID",
        });
      }
      return await getGooglePlaceDetails(corsHeaders, googleKey, placeId);
    }

    const businessName = cleanString(body.business_name);
    if (!businessName) {
      return jsonResponse(corsHeaders, 400, { error: "Missing business_name." });
    }

    const lat = finiteNumber(body.lat);
    const lng = finiteNumber(body.lng);
    return await searchGooglePlaces(corsHeaders, googleKey, businessName, lat, lng);
  } catch {
    logLookup("server_error", { errorCode: "BUSINESS_LOOKUP_SERVER_ERROR" });
    return jsonResponse(corsHeaders, 500, { error: "Server error" });
  }
});
