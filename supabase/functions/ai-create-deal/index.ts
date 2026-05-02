import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { validateStrongDealOnly } from "../_shared/strong-deal-guard.ts";
import { sendExpoPushBatch, haversineMiles } from "../_shared/expo-push.ts";
import { isDemoUserEmail } from "../ai-generate-ad-variants/demo-variants.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

type AiResult = {
  title: string;
  description: string;
  promo_line: string;
  hashtags?: string[];
};

const CHAT_MODEL = resolveOpenAiChatModel();

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");

    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey,
      {
        global: {
          headers: {
            Authorization: req.headers.get("Authorization")!,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const {
      business_id,
      photo_path,
      hint_text,
      price,
      end_time,
      max_claims,
      claim_cutoff_buffer_minutes,
    } = body ?? {};

    if (!business_id || !photo_path || !hint_text || !end_time || !max_claims) {
      return new Response(
        JSON.stringify({ error: "Missing required fields." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Defensive validation: client-supplied values must be sane before they hit the deal insert.
    const endTimeDate = new Date(String(end_time));
    if (Number.isNaN(endTimeDate.getTime())) {
      return new Response(
        JSON.stringify({ error: "Invalid end_time." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (endTimeDate.getTime() < Date.now() + 30 * 60 * 1000) {
      return new Response(
        JSON.stringify({ error: "end_time must be at least 30 minutes from now." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const maxClaimsNum = Number(max_claims);
    if (!Number.isFinite(maxClaimsNum) || !Number.isInteger(maxClaimsNum) || maxClaimsNum < 1 || maxClaimsNum > 10000) {
      return new Response(
        JSON.stringify({ error: "max_claims must be an integer between 1 and 10000." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (price != null && price !== "") {
      const priceNum = Number(price);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return new Response(
          JSON.stringify({ error: "price must be a non-negative number." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    if (claim_cutoff_buffer_minutes != null) {
      const cutNum = Number(claim_cutoff_buffer_minutes);
      if (!Number.isFinite(cutNum) || cutNum < 0 || cutNum > 240) {
        return new Response(
          JSON.stringify({ error: "claim_cutoff_buffer_minutes must be between 0 and 240." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    // Path-traversal guard: photo_path must live under the business's own folder.
    if (typeof photo_path === "string" && !photo_path.startsWith(`${business_id}/`)) {
      return new Response(
        JSON.stringify({ error: "Invalid photo_path." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, owner_id")
      .eq("id", business_id)
      .single();

    if (businessError || !business || business.owner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "You do not own this business." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from("deal-photos")
      .createSignedUrl(photo_path, 60 * 60 * 24 * 7);

    if (signedError || !signed?.signedUrl) {
      return new Response(
        JSON.stringify({ error: "Failed to access photo." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const baseUrl = supabaseUrl.replace(/\/$/, "");
    const encodedPath = String(photo_path)
      .split("/")
      .filter(Boolean)
      .map((seg: string) => encodeURIComponent(seg))
      .join("/");
    const posterPublicUrl = `${baseUrl}/storage/v1/object/public/deal-photos/${encodedPath}`;

    // Demo account: generate template copy without calling OpenAI
    const demoWantsLive = Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";
    if (isDemoUserEmail(user.email) && !demoWantsLive) {
      const ms = 600 + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, ms));
      const priceBit = price != null && price !== "" ? ` ($${price})` : "";
      const demoResult: AiResult = {
        title: `BOGO ${String(hint_text).slice(0, 30)}${priceBit}`.slice(0, 50),
        promo_line: `Buy one, get one free — today only!`.slice(0, 60),
        description: `Grab a friend and enjoy ${String(hint_text).slice(0, 60)} — two for the price of one. Walk-ins welcome!`.slice(0, 160),
      };

      const strongCheck = validateStrongDealOnly({
        title: demoResult.title,
        description: `${demoResult.promo_line}\n${demoResult.description}`,
      });
      if (!strongCheck.ok) {
        return new Response(JSON.stringify({ error: strongCheck.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: deal, error: insertError } = await supabase
        .from("deals")
        .insert({
          business_id,
          title: demoResult.title,
          description: demoResult.description,
          price: price ?? null,
          start_time: new Date().toISOString(),
          end_time,
          claim_cutoff_buffer_minutes: claim_cutoff_buffer_minutes ?? 15,
          max_claims,
          is_active: true,
          poster_url: posterPublicUrl,
          poster_storage_path: photo_path,
        })
        .select("id")
        .single();

      if (insertError) {
        return new Response(JSON.stringify({ error: "Failed to create deal." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          deal_id: deal.id,
          title: demoResult.title,
          description: demoResult.description,
          promo_line: demoResult.promo_line,
          poster_url: posterPublicUrl,
          poster_storage_path: photo_path,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!openAiKey?.trim()) {
      return new Response(
        JSON.stringify({
          error: "OPENAI_API_KEY is not set. Add it to Supabase Edge Function secrets.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const prompt = [
      "You are generating a mobile-optimized restaurant deal ad.",
      "Return concise, punchy copy.",
      "Use the provided hint and price.",
      "Keep title <= 50 chars and description <= 160 chars.",
      "Return JSON with title, description, promo_line.",
    ].join(" ");

    const aiBody = {
      model: CHAT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "deal_ad",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              promo_line: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
            },
            required: ["title", "description", "promo_line"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Hint: ${hint_text}` },
            { type: "text", text: `Price: ${price ?? "N/A"}` },
            { type: "image_url", image_url: { url: signed.signedUrl } },
          ],
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
      const text = await aiRes.text();
      return new Response(
        JSON.stringify({ error: "AI generation failed. Try again." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? "";
    let result: AiResult;
    try {
      result = JSON.parse(content);
    } catch {
      return new Response(
        JSON.stringify({ error: "AI response was invalid." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Keep AI generation as-is; enforce marketplace quality after model output.
    const strongCheck = validateStrongDealOnly({
      title: result.title,
      description: `${result.promo_line}\n${result.description}`,
    });
    if (!strongCheck.ok) {
      return new Response(
        JSON.stringify({ error: strongCheck.message }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: deal, error: insertError } = await supabase
      .from("deals")
      .insert({
        business_id,
        title: result.title,
        description: result.description,
        price: price ?? null,
        start_time: new Date().toISOString(),
        end_time,
        claim_cutoff_buffer_minutes: claim_cutoff_buffer_minutes ?? 15,
        max_claims,
        is_active: true,
        poster_url: posterPublicUrl,
        poster_storage_path: photo_path,
      })
      .select("id")
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: "Failed to create deal." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Best-effort push notifications to eligible consumers
    try {
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);

      const { data: bizRow } = await adminClient
        .from("businesses")
        .select("name, latitude, longitude")
        .eq("id", business_id)
        .single();

      const bizName = bizRow?.name ?? "TWOFER";
      const bizLat = typeof bizRow?.latitude === "number" ? bizRow.latitude : null;
      const bizLng = typeof bizRow?.longitude === "number" ? bizRow.longitude : null;

      const { data: favRows } = await adminClient
        .from("favorites")
        .select("user_id")
        .eq("business_id", business_id);
      const favIds = new Set((favRows ?? []).map((r: { user_id: string }) => r.user_id));

      const radiusIds = new Set<string>();
      if (bizLat != null && bizLng != null) {
        const { data: cRows } = await adminClient
          .from("consumer_profiles")
          .select("user_id, last_latitude, last_longitude, radius_miles")
          .eq("notification_mode", "all_nearby")
          .not("last_latitude", "is", null)
          .not("last_longitude", "is", null);
        for (const r of cRows ?? []) {
          const lat = Number(r.last_latitude);
          const lng = Number(r.last_longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          if (haversineMiles(bizLat, bizLng, lat, lng) <= (Number(r.radius_miles) || 3)) {
            radiusIds.add(r.user_id);
          }
        }
      }

      const allIds = new Set([...favIds, ...radiusIds]);
      allIds.delete(user.id);

      if (allIds.size > 0) {
        const { data: optOut } = await adminClient
          .from("consumer_profiles")
          .select("user_id")
          .in("user_id", [...allIds])
          .eq("notification_mode", "none");
        for (const r of optOut ?? []) allIds.delete(r.user_id);
      }

      if (allIds.size > 0) {
        const { data: tRows } = await adminClient
          .from("push_tokens")
          .select("expo_push_token")
          .in("user_id", [...allIds]);
        const tokens = (tRows ?? []).map((r: { expo_push_token: string }) => r.expo_push_token);
        if (tokens.length > 0) {
          await sendExpoPushBatch(tokens, bizName, result.title, {
            dealId: deal.id,
            path: `/deal/${deal.id}`,
          });
        }
      }
    } catch (pushErr) {
      console.error("[ai-create-deal] Push notification failed (non-fatal):", pushErr);
    }

    return new Response(
      JSON.stringify({
        deal_id: deal.id,
        title: result.title,
        description: result.description,
        promo_line: result.promo_line,
        poster_url: posterPublicUrl,
        poster_storage_path: photo_path,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
