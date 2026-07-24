import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { tryGetServiceRoleKey } from "../_shared/service-role-key.ts";

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = tryGetServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    return json(req, { error: "Activation status is not configured." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body." }, 400);
  }
  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{12,200}$/.test(sessionId)) {
    return json(req, { error: "Invalid Checkout Session." }, 400);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: checkout, error: checkoutError } = await admin
      .from("stripe_checkout_sessions")
      .select("business_id,status,updated_at")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();
    if (checkoutError) throw checkoutError;
    if (!checkout) return json(req, { state: "not_found" }, 404);

    const { data: subscription, error: subscriptionError } = await admin
      .from("business_subscriptions")
      .select("app_access_status,activation_checkout_session_id")
      .eq("business_id", checkout.business_id)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;

    const activated =
      subscription?.activation_checkout_session_id === sessionId &&
      ["trialing", "active", "past_due_grace"].includes(subscription?.app_access_status ?? "");
    const state = activated
      ? "active"
      : checkout.status === "expired" || checkout.status === "canceled" || checkout.status === "failed"
        ? checkout.status
        : "pending";
    return json(req, {
      state,
      retry_allowed: ["expired", "canceled", "failed"].includes(state),
      updated_at: checkout.updated_at,
    });
  } catch (error) {
    console.error(
      "[business-activation-status] lookup failed:",
      error instanceof Error ? error.message : String(error),
    );
    return json(req, { error: "Could not check activation status." }, 500);
  }
});
