import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOpenAiChatModel } from "../_shared/openai-chat-model.ts";
import { validateStrongDealOnly } from "../_shared/strong-deal-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AiResult = {
  title: string;
  description: string;
  promo_line: string;
  hashtags?: string[];
};

const CHAT_MODEL = resolveOpenAiChatModel();

serve(async (req) => {
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
        JSON.stringify({ error: "AI generation failed.", details: text }),
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
