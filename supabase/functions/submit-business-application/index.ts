import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";

type Payload = {
  business_name?: unknown;
  contact_name?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  business_type?: unknown;
  website_or_instagram?: unknown;
  slow_hours?: unknown;
  offer_interests?: unknown;
  launch_area?: unknown;
  terms_accepted?: unknown;
  privacy_acknowledged?: unknown;
  company_website?: unknown;
};

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function cleanEmail(value: unknown): string | null {
  const email = cleanString(value, 254)?.toLowerCase() ?? null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
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

  if (cleanString(payload.company_website, 120)) {
    return json(req, { ok: true });
  }

  const businessName = cleanString(payload.business_name, 120);
  const contactName = cleanString(payload.contact_name, 120);
  const email = cleanEmail(payload.email);
  const termsAccepted = payload.terms_accepted === true;
  const privacyAcknowledged = payload.privacy_acknowledged === true;

  if (!businessName || !contactName || !email || !termsAccepted || !privacyAcknowledged) {
    return json(req, { error: "Missing required fields." }, 400);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Business applications are not configured." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from("business_applications").insert({
      business_name: businessName,
      contact_name: contactName,
      email,
      phone: cleanString(payload.phone, 40),
      address: cleanString(payload.address, 240),
      business_type: cleanString(payload.business_type, 80),
      website_or_instagram: cleanString(payload.website_or_instagram, 180),
      slow_hours: cleanString(payload.slow_hours, 500),
      offer_interests: cleanString(payload.offer_interests, 500),
      launch_area: cleanString(payload.launch_area, 120),
      terms_accepted: true,
      privacy_acknowledged: true,
      status: "pending_review",
    });

    if (error) throw error;
    return json(req, { ok: true });
  } catch (err) {
    console.error("[submit-business-application] error:", err);
    return json(req, { error: "Could not submit business application." }, 500);
  }
});
