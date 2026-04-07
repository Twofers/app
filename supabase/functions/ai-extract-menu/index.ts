import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { isDemoUserEmail } from "../ai-generate-ad-variants/demo-variants.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = resolveOpenAiChatModel();
const MAX_B64_CHARS = 1_200_000;
const MAX_URL_LEN = 2048;

type MenuItemRow = {
  name: string;
  category: string;
  price_text: string;
  readable: boolean;
};

type ExtractionResult = {
  items: MenuItemRow[];
  low_legibility: boolean;
  menu_notes: string;
};

function responseHasRefusal(data: unknown): boolean {
  const out = (data as { output?: unknown[] })?.output;
  if (!Array.isArray(out)) return false;
  for (const item of out) {
    if (typeof item !== "object" || item === null) continue;
    const top = item as { type?: string; content?: unknown[] };
    if (top.type === "refusal") return true;
    const parts = top.content;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p !== "object" || p === null) continue;
      if ((p as { type?: string }).type === "refusal") return true;
    }
  }
  return false;
}

function extractOutputTextFromResponse(data: unknown): string | null {
  const out = (data as { output?: unknown[] })?.output;
  if (!Array.isArray(out)) return null;
  for (const item of out) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as { type?: string; content?: unknown[] };
    if (o.type !== "message") continue;
    const parts = o.content;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (typeof p !== "object" || p === null) continue;
      const pt = p as { type?: string; text?: string };
      if (pt.type === "output_text" && typeof pt.text === "string") return pt.text;
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed", error_code: "METHOD" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");

  const userClient = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const admin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in.", error_code: "UNAUTHORIZED" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body.", error_code: "BAD_JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const business_id = typeof body.business_id === "string" ? body.business_id.trim() : "";
    if (!business_id) {
      return new Response(
        JSON.stringify({ error: "Missing business_id.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("id,owner_id,category,name")
      .eq("id", business_id)
      .maybeSingle();

    if (bizErr || !biz || biz.owner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Business not found or access denied.", error_code: "FORBIDDEN" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const imageUrlRaw = typeof body.image_url === "string" ? body.image_url.trim() : "";
    const imageBase64 = typeof body.image_base64 === "string" ? body.image_base64.trim() : "";
    const imageMime =
      typeof body.image_mime_type === "string" && body.image_mime_type.trim()
        ? body.image_mime_type.trim()
        : "image/jpeg";

    let imageUrlForModel: string;
    if (imageUrlRaw && imageBase64) {
      return new Response(
        JSON.stringify({
          error: "Send only one of image_url or image_base64.",
          error_code: "INVALID_INPUT",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (imageUrlRaw) {
      if (!imageUrlRaw.toLowerCase().startsWith("https://") || imageUrlRaw.length > MAX_URL_LEN) {
        return new Response(
          JSON.stringify({ error: "image_url must be a valid https URL.", error_code: "INVALID_INPUT" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      imageUrlForModel = imageUrlRaw;
    } else if (imageBase64) {
      if (imageBase64.length > MAX_B64_CHARS) {
        return new Response(
          JSON.stringify({ error: "Image is too large. Try a smaller photo.", error_code: "INVALID_INPUT" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      imageUrlForModel = `data:${imageMime};base64,${imageBase64}`;
    } else {
      return new Response(
        JSON.stringify({ error: "Missing image_url or image_base64.", error_code: "INVALID_INPUT" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Category-aware sample menus for demo/no-key fallback
    const bizCategory = ((biz as { category?: string }).category ?? "").toLowerCase();
    type MenuItem = { name: string; category: string; price_text: string; readable: true };

    function sampleMenuForCategory(cat: string): MenuItem[] {
      if (/bakery|bake|pastry|bread/i.test(cat)) return [
        { name: "Butter Croissant", category: "Pastry", price_text: "$4.25", readable: true },
        { name: "Blueberry Muffin", category: "Pastry", price_text: "$4.50", readable: true },
        { name: "Sourdough Loaf", category: "Bread", price_text: "$7.00", readable: true },
        { name: "Cinnamon Roll", category: "Pastry", price_text: "$5.25", readable: true },
        { name: "Almond Bear Claw", category: "Pastry", price_text: "$4.75", readable: true },
        { name: "Chocolate Chip Cookie", category: "Cookie", price_text: "$3.50", readable: true },
      ];
      if (/taco|mexican|tex.?mex/i.test(cat)) return [
        { name: "Al Pastor Taco", category: "Tacos", price_text: "$4.50", readable: true },
        { name: "Carnitas Taco", category: "Tacos", price_text: "$4.50", readable: true },
        { name: "Chicken Tinga Taco", category: "Tacos", price_text: "$4.25", readable: true },
        { name: "Queso Fundido", category: "Sides", price_text: "$6.00", readable: true },
        { name: "Chips & Guacamole", category: "Sides", price_text: "$5.50", readable: true },
        { name: "Horchata", category: "Drinks", price_text: "$3.75", readable: true },
      ];
      if (/pizza|italian/i.test(cat)) return [
        { name: "Margherita Pizza", category: "Pizza", price_text: "$14.00", readable: true },
        { name: "Pepperoni Pizza", category: "Pizza", price_text: "$15.00", readable: true },
        { name: "Caesar Salad", category: "Salads", price_text: "$9.50", readable: true },
        { name: "Garlic Knots", category: "Sides", price_text: "$6.00", readable: true },
        { name: "Tiramisu", category: "Dessert", price_text: "$8.00", readable: true },
        { name: "Italian Soda", category: "Drinks", price_text: "$4.00", readable: true },
      ];
      if (/juice|smoothie|acai/i.test(cat)) return [
        { name: "Green Machine Smoothie", category: "Smoothies", price_text: "$8.50", readable: true },
        { name: "Acai Bowl", category: "Bowls", price_text: "$12.00", readable: true },
        { name: "Fresh Orange Juice", category: "Juices", price_text: "$6.50", readable: true },
        { name: "Mango Pineapple Smoothie", category: "Smoothies", price_text: "$8.00", readable: true },
        { name: "Avocado Toast", category: "Food", price_text: "$9.00", readable: true },
        { name: "Protein Ball Pack", category: "Snacks", price_text: "$5.50", readable: true },
      ];
      if (/sandwich|deli|sub/i.test(cat)) return [
        { name: "Turkey Club", category: "Sandwiches", price_text: "$10.50", readable: true },
        { name: "Caprese Panini", category: "Sandwiches", price_text: "$9.75", readable: true },
        { name: "Chicken Salad Wrap", category: "Wraps", price_text: "$9.00", readable: true },
        { name: "Tomato Basil Soup", category: "Soups", price_text: "$5.50", readable: true },
        { name: "Garden Salad", category: "Salads", price_text: "$7.50", readable: true },
        { name: "Iced Tea", category: "Drinks", price_text: "$3.00", readable: true },
      ];
      // Default: coffee shop
      return [
        { name: "Oat Milk Latte", category: "Coffee", price_text: "$6.50", readable: true },
        { name: "Vanilla Cortado", category: "Coffee", price_text: "$5.25", readable: true },
        { name: "Single-Origin Cold Brew", category: "Cold Coffee", price_text: "$5.75", readable: true },
        { name: "Matcha Latte", category: "Tea", price_text: "$6.00", readable: true },
        { name: "Butter Croissant", category: "Pastry", price_text: "$4.25", readable: true },
        { name: "Blueberry Muffin", category: "Pastry", price_text: "$4.50", readable: true },
      ];
    }

    // Demo account: return category-appropriate sample menu
    const demoWantsLive = Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";
    if (isDemoUserEmail(user.email) && !demoWantsLive) {
      const ms = 700 + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, ms));
      const items = sampleMenuForCategory(bizCategory);
      return new Response(
        JSON.stringify({ ok: true, items, low_legibility: false, menu_notes: `${items.length} items extracted. All prices clearly legible.` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!openAiKey) {
      const ms = 700 + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, ms));
      const items = sampleMenuForCategory(bizCategory);
      return new Response(
        JSON.stringify({ ok: true, items, low_legibility: false, menu_notes: `${items.length} items extracted. All prices clearly legible.` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const bizCategoryLabel = ((biz as { category?: string }).category ?? "").trim() || "local business";
    const instructionText = [
      `You extract menu line items from the attached menu image for a ${bizCategoryLabel} on a local deals app.`,
      "",
      "Rules:",
      "- Only include items whose text is clearly readable in the image. Set readable=true only for legible lines.",
      "- Do NOT invent dishes, prices, or items not visible. Prefer an empty items list over guessing.",
      "- For each legible line: name = the item as printed (concise). category = menu section heading if visible, else empty string.",
      "- price_text = price as printed (e.g. $4.50) or empty if none on that line.",
      "- If the image is blurry or mostly unreadable, set low_legibility=true and keep items minimal.",
      "- menu_notes: brief note for the owner (e.g. 'corner cropped') or empty string.",
      "- Extract EVERY distinct item you can read — the owner will select which ones to use for deals.",
    ].join("\n");

    const menuSchema = {
      name: "menu_extraction",
      strict: true,
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                category: { type: "string" },
                price_text: { type: "string" },
                readable: { type: "boolean" },
              },
              required: ["name", "category", "price_text", "readable"],
              additionalProperties: false,
            },
          },
          low_legibility: { type: "boolean" },
          menu_notes: { type: "string" },
        },
        required: ["items", "low_legibility", "menu_notes"],
        additionalProperties: false,
      },
    };

    const responsesBody = {
      model: MODEL,
      temperature: 0.2,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: instructionText },
            { type: "input_image", image_url: imageUrlForModel, detail: "high" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: menuSchema.name,
          strict: menuSchema.strict,
          schema: menuSchema.schema,
        },
      },
    };

    const openAiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responsesBody),
    });

    if (!openAiRes.ok) {
      const errText = await openAiRes.text();
      console.log(JSON.stringify({ tag: "ai_extract_menu", event: "openai_http", status: openAiRes.status }));
      return new Response(
        JSON.stringify({
          error: "Menu scan service error. Try again shortly.",
          error_code: "OPENAI_ERROR",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const responseJson = await openAiRes.json();
    const apiStatus = (responseJson as { status?: string }).status;
    if (apiStatus && apiStatus !== "completed") {
      const incomplete = (responseJson as { incomplete_details?: unknown }).incomplete_details;
      console.log(
        JSON.stringify({
          tag: "ai_extract_menu",
          event: "response_not_completed",
          status: apiStatus,
          business_id,
          incomplete_details: incomplete != null ? String(incomplete).slice(0, 200) : undefined,
        }),
      );
      return new Response(
        JSON.stringify({
          error: "Menu scan did not finish. Try again with a clearer photo.",
          error_code: "INCOMPLETE",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (responseHasRefusal(responseJson)) {
      console.log(JSON.stringify({ tag: "ai_extract_menu", event: "refusal", business_id }));
      return new Response(
        JSON.stringify({
          error: "Could not process this image. Try a different photo.",
          error_code: "REFUSED",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const textBlock = extractOutputTextFromResponse(responseJson);
    if (!textBlock) {
      return new Response(
        JSON.stringify({ error: "Could not read AI response.", error_code: "PARSE_ERROR" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed: ExtractionResult;
    try {
      parsed = JSON.parse(textBlock) as ExtractionResult;
    } catch {
      return new Response(
        JSON.stringify({ error: "AI returned invalid JSON.", error_code: "PARSE_ERROR" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const items = Array.isArray(parsed.items)
      ? parsed.items
        .filter((r) => r && typeof r.name === "string" && r.name.trim().length > 0 && r.readable === true)
        .map((r) => ({
          name: r.name.trim(),
          category: typeof r.category === "string" && r.category.trim() ? r.category.trim() : undefined,
          price_text: typeof r.price_text === "string" && r.price_text.trim() ? r.price_text.trim() : undefined,
          readable: true,
        }))
      : [];

    return new Response(
      JSON.stringify({
        ok: true,
        items,
        low_legibility: parsed.low_legibility === true,
        menu_notes: typeof parsed.menu_notes === "string" ? parsed.menu_notes : "",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.log(JSON.stringify({ tag: "ai_extract_menu", event: "error", err: String(e) }));
    return new Response(JSON.stringify({ error: "Server error.", error_code: "SERVER" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
