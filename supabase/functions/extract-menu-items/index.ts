import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = resolveOpenAiChatModel();

const SYSTEM_PROMPT = `You are a menu extraction assistant for a restaurant/cafe deals app called TWOFER.
Given a photo of a menu, extract all identifiable menu items as structured JSON.

Return a JSON object with this exact shape:
{
  "items": [
    {
      "name": "Item name",
      "description": "Brief description if visible, or null",
      "category": "Category like Coffee, Pastry, Sandwich, Drink, etc.",
      "price": 5.99
    }
  ],
  "confidence": 0.85
}

Rules:
- Extract every distinct menu item you can identify.
- "price" should be a number (no currency symbol). Set to null if not visible or extraction is disabled.
- "category" should be inferred from the item type if not explicit on the menu.
- "description" can be null if not visible.
- "confidence" is 0-1 indicating how confident you are in the overall extraction.
- If the image is not a menu, return {"items": [], "confidence": 0, "error": "Image does not appear to be a menu"}.
- Return ONLY valid JSON, no markdown fences.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");

  if (!openAiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth check
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Parse request
  let body: { image_base64?: string; extract_prices?: boolean; business_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { image_base64, extract_prices = true, business_id } = body;

  if (!image_base64) {
    return new Response(JSON.stringify({ error: "image_base64 is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!business_id) {
    return new Response(JSON.stringify({ error: "business_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify business ownership
  const { data: biz, error: bizError } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", business_id)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (bizError || !biz) {
    return new Response(JSON.stringify({ error: "Business not found or not owned by user" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Build prompt with price extraction toggle
  const userPrompt = extract_prices
    ? "Extract all menu items with their prices from this menu photo."
    : "Extract all menu item names and descriptions from this menu photo. Do NOT extract prices — set all price fields to null.";

  try {
    const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${image_base64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!openAiRes.ok) {
      const errText = await openAiRes.text();
      console.error("OpenAI error:", errText.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "AI extraction failed", detail: errText.slice(0, 200) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiResult = await openAiRes.json();
    const rawContent = aiResult.choices?.[0]?.message?.content ?? "{}";

    let parsed: { items?: unknown[]; confidence?: number; error?: string };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return new Response(
        JSON.stringify({ error: "AI returned invalid JSON", raw: rawContent.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Log to ai_generation_logs
    await supabaseAdmin.from("ai_generation_logs").insert({
      business_id,
      user_id: user.id,
      request_type: "menu_extract",
      input_mode: "image_only",
      prompt_text: userPrompt,
      prompt_version: "v1",
      model: MODEL,
      success: Array.isArray(parsed.items) && parsed.items.length > 0,
      response_payload: parsed,
      openai_called: true,
      input_token_count: aiResult.usage?.prompt_tokens ?? null,
      output_token_count: aiResult.usage?.completion_tokens ?? null,
      estimated_cost_usd: null,
      request_hash: await sha256Hex(`menu_extract:${business_id}:${Date.now()}`),
    });

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("extract-menu-items error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err).slice(0, 200) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
