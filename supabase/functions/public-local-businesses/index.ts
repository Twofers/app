import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, max);
  return cleaned || null;
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    return {
      city: url.searchParams.get("city"),
      query: url.searchParams.get("query"),
      limit: url.searchParams.get("limit"),
    };
  }
  try {
    const payload = await req.json();
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return json(req, { error: "Local businesses are not configured." }, 500);
    }

    const payload = await readPayload(req);
    const limit = Math.min(250, Math.max(1, Number(payload.limit) || 100));
    const supabase = createClient(supabaseUrl, anonKey);
    const { data, error } = await supabase.rpc("public_local_businesses", {
      p_city: cleanString(payload.city, 80),
      p_query: cleanString(payload.query, 120),
      p_limit: limit,
    });
    if (error) throw error;

    return json(req, { ok: true, businesses: data ?? [] });
  } catch (error) {
    console.error("[public-local-businesses] error:", error);
    return json(req, { error: "Could not load local businesses." }, 500);
  }
});
