import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel, chatCompletionTuning } from "../_shared/openai-chat-model.ts";
import { validateStrongDealOnly } from "../_shared/strong-deal-guard.ts";
import { sendExpoPushBatch, haversineMiles } from "../_shared/expo-push.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { logAiCost, openAiRequestIdFromHeaders } from "../_shared/ai-costs.ts";
import {
  dealEligibilityErrorPayload,
  validateDealEligibility,
  type DealEligibilityInput,
  type DealEligibilityResult,
} from "../../../lib/deal-eligibility.ts";

type AiResult = {
  title: string;
  description: string;
  promo_line: string;
  hashtags?: string[];
};

const DEAL_ELIGIBILITY_COLUMN_KEYS = [
  "deal_status",
  "eligibility_status",
  "eligibility_reason_code",
  "eligibility_message",
  "customer_value_percent",
  "deal_type",
  "applies_to",
  "discount_percent",
  "required_purchase_quantity",
  "free_item_quantity",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_description",
  "free_item_retail_value_cents",
  "free_item_discount_percent",
  "item_description",
  "item_retail_value_cents",
] as const;

function parseDealEligibilityInput(value: unknown): DealEligibilityInput | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DealEligibilityInput)
    : null;
}

function dealNotEligibleForAiResponse(
  input: DealEligibilityInput | null,
  corsHeaders: Record<string, string>,
) {
  const eligibility = input
    ? validateDealEligibility(input)
    : {
        eligible: false,
        eligibilityStatus: "INVALID" as const,
        reasonCode: "INVALID_DEAL_TYPE" as const,
        message:
          "This deal is not eligible for AI ad generation yet. Twofer deals must be free-item offers or at least 40% off a single item.",
      };
  if (eligibility.eligible) return { response: null, eligibility, input };
  return {
    response: new Response(
      JSON.stringify({
        ...dealEligibilityErrorPayload(eligibility),
        error: "DEAL_NOT_ELIGIBLE_FOR_AI",
        error_code: "DEAL_NOT_ELIGIBLE_FOR_AI",
      }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    ),
    eligibility,
    input,
  };
}

function dealEligibilityColumnsFromInput(
  input: DealEligibilityInput,
  result: DealEligibilityResult,
): Record<string, unknown> {
  return {
    deal_status: "LIVE",
    eligibility_status: result.eligibilityStatus,
    eligibility_reason_code: result.reasonCode ?? null,
    eligibility_message: result.message ?? null,
    customer_value_percent: result.customerValuePercent ?? null,
    deal_type: input.dealType ?? null,
    applies_to: input.appliesTo ?? "SINGLE_ITEM",
    discount_percent: input.discountPercent ?? null,
    required_purchase_quantity: input.requiredPurchaseQuantity ?? null,
    free_item_quantity: input.freeItemQuantity ?? null,
    required_item_description: input.requiredItemDescription ?? null,
    required_item_retail_value_cents: input.requiredItemRetailValueCents ?? null,
    free_item_description: input.freeItemDescription ?? null,
    free_item_retail_value_cents: input.freeItemRetailValueCents ?? null,
    free_item_discount_percent: input.freeItemDiscountPercent ?? null,
    item_description: input.itemDescription ?? null,
    item_retail_value_cents: input.itemRetailValueCents ?? null,
  };
}

function isMissingDealEligibilityColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST204" || error?.code === "42703") &&
    DEAL_ELIGIBILITY_COLUMN_KEYS.some((key) => message.includes(key))
  );
}

function omitDealEligibilityColumns<T extends Record<string, unknown>>(row: T) {
  const next = { ...row };
  for (const key of DEAL_ELIGIBILITY_COLUMN_KEYS) delete next[key];
  return next;
}

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
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
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
      deal_eligibility,
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

    const parsedEligibilityInput = parseDealEligibilityInput(deal_eligibility);
    const eligibilityPreflight = dealNotEligibleForAiResponse(parsedEligibilityInput, corsHeaders);
    if (eligibilityPreflight.response) return eligibilityPreflight.response;
    const eligibilityInput = eligibilityPreflight.input!;
    const eligibilityResult = eligibilityPreflight.eligibility as DealEligibilityResult;

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
    const requestGroupId = crypto.randomUUID();

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
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              promo_line: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
            },
            // strict mode requires every property to be listed in `required`.
            required: ["title", "description", "promo_line", "hashtags"],
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
      ...chatCompletionTuning(CHAT_MODEL, { maxTokens: 1024 }),
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
      await logAiCost(supabase, {
        businessId: business_id,
        ownerUserId: user.id,
        requestGroupId,
        feature: "legacy_create_deal",
        model: CHAT_MODEL,
        endpoint: "chat.completions",
        openaiRequestId: openAiRequestIdFromHeaders(aiRes.headers),
        success: false,
        errorCode: `HTTP_${aiRes.status}`,
        errorMessage: text.slice(0, 500),
      });
      return new Response(
        JSON.stringify({ error: "AI generation failed.", details: text }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiJson = await aiRes.json();
    await logAiCost(supabase, {
      businessId: business_id,
      ownerUserId: user.id,
      requestGroupId,
      feature: "legacy_create_deal",
      model: CHAT_MODEL,
      endpoint: "chat.completions",
      usage: aiJson?.usage ?? null,
      openaiRequestId: openAiRequestIdFromHeaders(aiRes.headers),
      responseId: typeof aiJson?.id === "string" ? aiJson.id : null,
      success: true,
    });
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

    const dealInsertRow = {
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
        ...dealEligibilityColumnsFromInput(eligibilityInput, eligibilityResult),
      };

    let insertResult = await supabase
      .from("deals")
      .insert(dealInsertRow)
      .select("id")
      .single();
    if (isMissingDealEligibilityColumn(insertResult.error)) {
      insertResult = await supabase
        .from("deals")
        .insert(omitDealEligibilityColumns(dealInsertRow))
        .select("id")
        .single();
    }
    const { data: deal, error: insertError } = insertResult;

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

      const bizName = bizRow?.name ?? "Twofer";
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
