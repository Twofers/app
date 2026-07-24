import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { tryGetServiceRoleKey } from "../_shared/service-role-key.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  try {
    const payload = await req.json();
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function cleanString(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, max);
  return cleaned || null;
}

function cleanUuid(value: unknown): string | null {
  const cleaned = cleanString(value, 80);
  return cleaned && UUID_RE.test(cleaned) ? cleaned : null;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = tryGetServiceRoleKey();
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Business requests are not configured." }, 500);
    }

    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) return json(req, { error: "Sign in to request this business." }, 401);
    if (isRedeemerUser(user)) return forbiddenForRedeemerResponse(corsHeaders);

    const payload = await readPayload(req);
    const prospectId = cleanUuid(payload.prospect_id);
    const businessId = cleanUuid(payload.business_id);
    if ((!prospectId && !businessId) || (prospectId && businessId)) {
      return json(req, { error: "Choose one business to request." }, 400);
    }

    const signalType = cleanString(payload.signal_type, 24) || "request";
    if (!["favorite", "request", "invite", "view"].includes(signalType)) {
      return json(req, { error: "Unsupported request type." }, 400);
    }

    const zipCode = cleanString(payload.zip_code, 5);
    if (zipCode && !/^[0-9]{5}$/.test(zipCode)) {
      return json(req, { error: "ZIP code must be 5 digits." }, 400);
    }

    const radiusMiles = payload.radius_miles == null || payload.radius_miles === ""
      ? null
      : Math.min(100, Math.max(0, Number(payload.radius_miles) || 0));
    const today = new Date().toISOString().slice(0, 10);
    const dedupeKey = await sha256Hex([
      user.id,
      prospectId ? `prospect:${prospectId}` : `business:${businessId}`,
      signalType,
      today,
    ].join("|"));

    const { data, error } = await supabaseAdmin.rpc("record_business_demand_signal", {
      p_prospect_id: prospectId,
      p_business_id: businessId,
      p_user_id: user.id,
      p_signal_type: signalType,
      p_source_surface: cleanString(payload.source_surface, 80) || "website",
      p_zip_code: zipCode,
      p_radius_miles: radiusMiles,
      p_dedupe_key: dedupeKey,
    });
    if (error) throw error;

    return json(req, {
      ok: true,
      saved: data?.inserted === true,
      deduped: data?.deduped === true,
      message: "Request saved. This does not mean the business is active on Twofer yet.",
    });
  } catch (error) {
    console.error("[request-business-on-twofer] error:", error);
    return json(req, { error: "Could not save this request." }, 500);
  }
});
