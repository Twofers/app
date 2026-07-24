import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { cleanEmail, cleanString } from "../_shared/business-onboarding-sync.ts";
import { clientIpFromRequest } from "../_shared/client-ip.ts";
import { tryGetServiceRoleKey } from "../_shared/service-role-key.ts";

const RATE_LIMIT_WINDOW_MINUTES = 60;
const RATE_LIMIT_MAX_PER_IP = 6;

const ALLOWED_LOCALES = new Set(["en", "es", "ko"]);
const ALLOWED_SOURCES = new Set(["website-hero", "website-customers", "website"]);

type Payload = {
  email?: unknown;
  locale?: unknown;
  source?: unknown;
  company_website?: unknown;
};

type DbClient = SupabaseClient<any, any, any, any, any>;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

async function isRateLimited(supabase: DbClient, ip: string | null): Promise<boolean> {
  if (!ip) return false;
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("launch_signups")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", ip)
    .gte("created_at", windowStart);
  if (error) throw error;
  return (count ?? 0) >= RATE_LIMIT_MAX_PER_IP;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }

  // Honeypot: real visitors never fill this hidden field. Answer ok so bots
  // cannot tell they were dropped.
  if (cleanString(payload.company_website, 120)) {
    return json(req, { ok: true });
  }

  const email = cleanEmail(payload.email);
  if (!email) {
    return json(req, { error: "Enter a valid email address." }, 400);
  }

  const rawLocale = cleanString(payload.locale, 5)?.toLowerCase() ?? null;
  const locale = rawLocale && ALLOWED_LOCALES.has(rawLocale) ? rawLocale : null;
  const rawSource = cleanString(payload.source, 40) ?? "website";
  const source = ALLOWED_SOURCES.has(rawSource) ? rawSource : "website";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = tryGetServiceRoleKey();
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Launch signups are not configured." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const requestIp = clientIpFromRequest(req);
    if (await isRateLimited(supabase, requestIp)) {
      return json(req, { error: "Too many requests. Please try again later." }, 429);
    }

    // ignoreDuplicates keeps re-submits of the same address silent: the
    // response never reveals whether an email was already on the list.
    const { error } = await supabase
      .from("launch_signups")
      .upsert(
        { email, locale, source, ip_address: requestIp },
        { onConflict: "email", ignoreDuplicates: true },
      );
    if (error) throw error;

    return json(req, { ok: true });
  } catch (err) {
    console.error("[submit-launch-signup] error:", err);
    return json(req, { error: "Could not save your email." }, 500);
  }
});
