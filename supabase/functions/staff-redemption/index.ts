import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { isRedeemerUser } from "../_shared/redemption-role.ts";

function json(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function statusCode(status: unknown): number {
  switch (status) {
    case "unauthorized":
      return 401;
    case "not_found":
      return 404;
    case "already_redeemed":
    case "not_redeemable":
      return 409;
    case "expired":
      return 410;
    case "deal_inactive":
    case "invalid_input":
      return 400;
    default:
      return 400;
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized. Please log in." }, 401, corsHeaders);
    }
    if (!isRedeemerUser(user)) {
      return json({ error: "This endpoint is only for Redemption Mode staff sessions." }, 403, corsHeaders);
    }

    let body: { action?: unknown; token?: unknown; short_code?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON in request body" }, 400, corsHeaders);
    }

    const action = body.action === "confirm" ? "confirm" : body.action === "preview" ? "preview" : null;
    if (!action) {
      return json({ error: "Missing action." }, 400, corsHeaders);
    }

    const rpcName = action === "confirm" ? "confirm_staff_redemption" : "preview_staff_redemption";
    const { data, error } = await supabase.rpc(rpcName, {
      p_token: typeof body.token === "string" ? body.token : null,
      p_short_code: typeof body.short_code === "string" ? body.short_code : null,
    });

    if (error) {
      console.error("[staff-redemption] rpc failed", error);
      return json({ error: "Could not process redemption." }, 500, corsHeaders);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") {
      return json({ error: "Could not process redemption." }, 500, corsHeaders);
    }

    const result = row as Record<string, unknown>;
    if (result.ok !== true) {
      return json({ ...result, error: String(result.message ?? "Redemption failed.") }, statusCode(result.status), corsHeaders);
    }

    return json(result, 200, corsHeaders);
  } catch (err) {
    console.error("[staff-redemption] unexpected error", err);
    return json({ error: "Server error" }, 500, corsHeaders);
  }
});
