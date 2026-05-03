import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { isDemoUserEmail } from "../ai-generate-ad-variants/demo-variants.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

type BusinessResult = {
  name: string;
  formatted_address: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  category: string;
  hours_text: string;
  website: string;
  source: "google_places" | "ai_estimate";
};

/** Map Google Places types to user-friendly categories. */
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

function mapCategory(types: string[]): string {
  for (const t of types) {
    const mapped = TYPE_MAP[t];
    if (mapped) return mapped;
  }
  return "Local business";
}

/** DFW center coordinates (Irving/Coppell area). */
const DFW_LAT = 32.85;
const DFW_LNG = -96.97;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const business_name = typeof body.business_name === "string" ? body.business_name.trim() : "";
    if (!business_name) {
      return new Response(
        JSON.stringify({ error: "Missing business_name." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
    const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;

    // Demo account: return mock DFW coffee shop data
    const demoWantsLive = Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";
    if (isDemoUserEmail(user.email) && !demoWantsLive) {
      const ms = 500 + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, ms));
      const demoResults: BusinessResult[] = [
        {
          name: business_name,
          formatted_address: "123 Main St, Irving, TX 75038",
          phone: "(972) 555-0123",
          lat: 32.8140,
          lng: -96.9489,
          category: "Cafe",
          hours_text: "Mon-Fri: 6 AM - 8 PM\nSat-Sun: 7 AM - 6 PM",
          website: "",
          source: "google_places",
        },
      ];
      return new Response(
        JSON.stringify({ ok: true, results: demoResults }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Try Google Places first
    const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
    if (googleKey) {
      try {
        const biasLat = lat ?? DFW_LAT;
        const biasLng = lng ?? DFW_LNG;

        const placesRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": googleKey,
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.types,places.location,places.regularOpeningHours,places.websiteUri",
          },
          body: JSON.stringify({
            textQuery: `${business_name} Texas`,
            locationBias: {
              circle: {
                center: { latitude: biasLat, longitude: biasLng },
                radiusMeters: 50000,
              },
            },
            maxResultCount: 3,
          }),
        });

        if (placesRes.ok) {
          const placesJson = await placesRes.json();
          const places = placesJson.places;
          if (Array.isArray(places) && places.length > 0) {
            const results: BusinessResult[] = places.slice(0, 3).map((p: Record<string, unknown>) => {
              const loc = p.location as { latitude?: number; longitude?: number } | undefined;
              const hours = p.regularOpeningHours as { weekdayDescriptions?: string[] } | undefined;
              const displayName = p.displayName as { text?: string } | undefined;
              return {
                name: displayName?.text ?? business_name,
                formatted_address: typeof p.formattedAddress === "string" ? p.formattedAddress : "",
                phone: typeof p.nationalPhoneNumber === "string" ? p.nationalPhoneNumber : "",
                lat: typeof loc?.latitude === "number" ? loc.latitude : null,
                lng: typeof loc?.longitude === "number" ? loc.longitude : null,
                category: mapCategory(Array.isArray(p.types) ? p.types as string[] : []),
                hours_text: Array.isArray(hours?.weekdayDescriptions)
                  ? hours!.weekdayDescriptions.join("\n")
                  : "",
                website: typeof p.websiteUri === "string" ? p.websiteUri : "",
                source: "google_places" as const,
              };
            });

            return new Response(
              JSON.stringify({ ok: true, results }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        } else {
          console.log(JSON.stringify({
            tag: "ai_business_lookup",
            event: "google_places_error",
            status: placesRes.status,
          }));
        }
      } catch (e) {
        console.log(JSON.stringify({ tag: "ai_business_lookup", event: "google_places_exception", err: String(e) }));
      }
    }

    // Fallback: use OpenAI to estimate business info
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) {
      return new Response(
        JSON.stringify({ error: "No API keys configured for business lookup." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const CHAT_MODEL = resolveOpenAiChatModel();
    const locationHint = lat && lng
      ? `near coordinates ${lat}, ${lng}`
      : "in the DFW (Dallas-Fort Worth) area of Texas";

    const aiBody = {
      model: CHAT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "business_lookup",
          schema: {
            type: "object",
            properties: {
              results: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    formatted_address: { type: "string" },
                    phone: { type: "string" },
                    lat: { type: "number" },
                    lng: { type: "number" },
                    category: { type: "string" },
                    hours_text: { type: "string" },
                    website: { type: "string" },
                  },
                  required: ["name", "formatted_address", "phone", "lat", "lng", "category", "hours_text", "website"],
                  additionalProperties: false,
                },
              },
            },
            required: ["results"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You help find real business information for local cafes, bakeries, and restaurants.",
            "Given a business name and location, return your best guess at the business details.",
            "If you're unsure, provide your best estimate but keep it realistic.",
            "Return 1-3 results. Include realistic Texas addresses, phone numbers, and hours.",
            "For category, use simple labels like: Cafe, Bakery, Coffee shop, Restaurant, Bar.",
            "For hours_text, use format like: Mon-Fri: 6 AM - 8 PM\\nSat-Sun: 7 AM - 6 PM",
            "Return JSON only with a results array.",
          ].join(" "),
        },
        {
          role: "user",
          content: `Find business info for "${business_name}" ${locationHint}.`,
        },
      ],
    };

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aiBody),
    });

    if (!aiRes.ok) {
      return new Response(
        JSON.stringify({ error: "Business lookup failed. Try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? "";
    let parsed: { results: Omit<BusinessResult, "source">[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      return new Response(
        JSON.stringify({ error: "Could not parse lookup results." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: BusinessResult[] = (parsed.results ?? []).slice(0, 3).map((r) => ({
      ...r,
      source: "ai_estimate" as const,
    }));

    return new Response(
      JSON.stringify({ ok: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.log(JSON.stringify({ tag: "ai_business_lookup", event: "error", err: String(err) }));
    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
