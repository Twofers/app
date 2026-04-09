import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { isDemoUserEmail } from "../ai-generate-ad-variants/demo-variants.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

type AiResult = {
  title: string;
  promo_line: string;
  description: string;
};

// ── Demo deal-copy engine (quality/craft tone) ─────────────
type ItemType = "latte" | "cortado" | "cold_brew" | "matcha" | "croissant" | "muffin" | "pastry" | "combo" | "generic";

const ITEM_PATTERNS: [ItemType, RegExp][] = [
  ["latte", /oat\s*milk\s*latte|latte/i],
  ["cortado", /cortado|espresso/i],
  ["cold_brew", /cold\s*brew|iced\s*coffee|nitro/i],
  ["matcha", /matcha|green\s*tea/i],
  ["croissant", /croissant/i],
  ["muffin", /muffin|blueberry/i],
  ["pastry", /pastry|baked|scone|cookie/i],
  ["combo", /combo|pair|bundle|\+|and a|with a/i],
];

function detectItem(hint: string): ItemType {
  for (const [t, rx] of ITEM_PATTERNS) {
    if (rx.test(hint)) return t;
  }
  return "generic";
}

function clipField(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "\u2026";
}

function buildDemoDealCopyResult(hint: string, price: unknown, bizName: string): AiResult {
  const itemType = detectItem(hint);
  const pTag = price != null && price !== "" ? ` \u00B7 $${price}` : "";

  const bank: Record<ItemType, AiResult> = {
    latte: {
      title: clipField(`Handcrafted lattes, twice the joy${pTag}`, 50),
      promo_line: clipField(`Every latte at ${bizName} is made fresh with care`, 60),
      description: clipField(`Two hand-pulled lattes for the price of one. Made with single-origin beans and steamed oat milk — the way a latte should be.`, 160),
    },
    cortado: {
      title: clipField(`Crafted cortado, doubled${pTag}`, 50),
      promo_line: clipField(`Precision-pulled at ${bizName}`, 60),
      description: clipField(`A properly balanced cortado deserves a second pour. Two for one — same care in every cup, no shortcuts.`, 160),
    },
    cold_brew: {
      title: clipField(`Small-batch cold brew 2-for-1${pTag}`, 50),
      promo_line: clipField(`Steeped 18 hours at ${bizName}`, 60),
      description: clipField(`Our single-origin cold brew is steeped low and slow for a clean, smooth finish. Bring a friend and split the chill.`, 160),
    },
    matcha: {
      title: clipField(`Ceremonial matcha, on us${pTag}`, 50),
      promo_line: clipField(`Stone-ground and whisked fresh at ${bizName}`, 60),
      description: clipField(`Real ceremonial-grade matcha, not the powdered stuff. Buy one, get one — bright, earthy, and made to order.`, 160),
    },
    croissant: {
      title: clipField(`Freshly baked croissant, doubled${pTag}`, 50),
      promo_line: clipField(`Warm from the oven at ${bizName}`, 60),
      description: clipField(`Buttery, flaky, and laminated by hand every morning. Take two — one for now and one for later.`, 160),
    },
    muffin: {
      title: clipField(`Blueberry muffins, buy one get one${pTag}`, 50),
      promo_line: clipField(`Baked fresh daily at ${bizName}`, 60),
      description: clipField(`Bursting with real blueberries and topped with a crunchy streusel. Grab a pair and share the morning.`, 160),
    },
    pastry: {
      title: clipField(`Artisan pastry, two for one${pTag}`, 50),
      promo_line: clipField(`From our bakery case at ${bizName}`, 60),
      description: clipField(`Every pastry is shaped and proofed by hand. Pick your favorite, and the second one's on us.`, 160),
    },
    combo: {
      title: clipField(`The perfect pairing${pTag}`, 50),
      promo_line: clipField(`Crafted together at ${bizName}`, 60),
      description: clipField(`Some things are better in pairs. Enjoy a drink and a bite — the second item is free when you order both.`, 160),
    },
    generic: {
      title: clipField(`Crafted with care, doubled for you${pTag}`, 50),
      promo_line: clipField(`Made fresh at ${bizName}`, 60),
      description: clipField(`Quality ingredients, honest portions, and now twice the reason to visit. Buy one, get one — no catch, no rush.`, 160),
    },
  };

  return bank[itemType];
}

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

    const { hint_text, price, business_name, business_id: bodyBusinessId } = body ?? {};

    if (!hint_text) {
      return new Response(
        JSON.stringify({ error: "Missing hint_text." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Demo account: return template copy without calling OpenAI
    const demoWantsLive = Deno.env.get("AI_ADS_DEMO_USE_LIVE")?.trim().toLowerCase() === "true";
    if (isDemoUserEmail(user.email) && !demoWantsLive) {
      const ms = 600 + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, ms));
      const bizName = business_name ?? "Demo Roasted Bean Coffee";
      const result = buildDemoDealCopyResult(String(hint_text), price, bizName);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!openAiKey) {
      const ms = 600 + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, ms));
      const bizName = business_name ?? "your business";
      const result = buildDemoDealCopyResult(String(hint_text), price, bizName);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up business for logging/quota (optional body param or fallback to owner lookup)
    let resolvedBusinessId: string | null = typeof bodyBusinessId === "string" ? bodyBusinessId : null;
    if (!resolvedBusinessId) {
      const { data: biz } = await supabase
        .from("businesses")
        .select("id")
        .eq("owner_id", user.id)
        .limit(1)
        .maybeSingle();
      resolvedBusinessId = biz?.id ?? null;
    }

    const CHAT_MODEL = resolveOpenAiChatModel();

    const DEFAULT_MONTHLY_LIMIT = Number(Deno.env.get("AI_COPY_MONTHLY_LIMIT") ?? "60");
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    if (resolvedBusinessId) {
      const { count: usedThisMonth } = await supabase
        .from("ai_generation_logs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", resolvedBusinessId)
        .eq("request_type", "deal_copy")
        .gte("created_at", monthStart.toISOString());
      if (usedThisMonth !== null && usedThisMonth >= DEFAULT_MONTHLY_LIMIT) {
        return new Response(
          JSON.stringify({ error: "Monthly AI copy limit reached. Try again next month." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const prompt = [
      "You write premium ad copy for independent cafés and local food businesses on a mobile deals app called Twofer.",
      "",
      "VOICE & TONE:",
      "- Write like a specialty coffee shop's best marketer — confident, warm, never corporate.",
      "- Lead with what makes the product special: ingredients, process, craft, freshness.",
      "- Use sensory language (\"hand-pulled\", \"stone-ground\", \"slow-steeped\", \"freshly baked\", \"small-batch\").",
      "- Avoid generic ad-speak: no \"best deal ever\", \"amazing offer\", \"you won't believe\", \"act now\", \"don't miss out\".",
      "- Avoid exclamation marks. Confidence doesn't shout.",
      "- The deal should feel like a generous invitation, not a clearance sale.",
      "",
      "STRUCTURE:",
      "- title: The hook. Highlight the craft or the item, not just the discount. <= 50 chars.",
      "- promo_line: One line that makes the reader feel something. <= 60 chars.",
      "- description: Why this is worth the trip — real ingredients, real care, real deal. <= 160 chars.",
      "- Use the hint text and optional price. Weave in the business name naturally if it fits.",
      "- Return JSON only with title, promo_line, description.",
    ].join("\n");

    const aiBody = {
      model: CHAT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "deal_copy",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              promo_line: { type: "string" },
              description: { type: "string" },
            },
            required: ["title", "promo_line", "description"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { type: "text", text: `Business: ${business_name ?? "Local business"}` },
            { type: "text", text: `Hint: ${hint_text}` },
            { type: "text", text: `Price: ${price ?? "N/A"}` },
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
        JSON.stringify({ error: "AI generation failed.", details: text }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const aiJson = await aiRes.json();
    const usage = aiJson?.usage;
    const content = aiJson?.choices?.[0]?.message?.content ?? "";
    let result: AiResult;
    try {
      result = JSON.parse(content);
    } catch {
      if (resolvedBusinessId) {
        void supabase.from("ai_generation_logs").insert({
          business_id: resolvedBusinessId,
          user_id: user.id,
          request_type: "deal_copy",
          request_hash: `deal_copy:parse_error`,
          input_mode: "text",
          model: CHAT_MODEL,
          success: false,
          failure_reason: "PARSE_ERROR",
          openai_called: true,
          input_token_count: usage?.prompt_tokens ?? null,
          output_token_count: usage?.completion_tokens ?? null,
        });
      }
      return new Response(
        JSON.stringify({ error: "AI response was invalid." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (resolvedBusinessId) {
      void supabase.from("ai_generation_logs").insert({
        business_id: resolvedBusinessId,
        user_id: user.id,
        request_type: "deal_copy",
        request_hash: `deal_copy:${hint_text.slice(0, 60)}`,
        input_mode: "text",
        model: CHAT_MODEL,
        success: true,
        openai_called: true,
        input_token_count: usage?.prompt_tokens ?? null,
        output_token_count: usage?.completion_tokens ?? null,
      });
    }

    return new Response(
      JSON.stringify(result),
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
