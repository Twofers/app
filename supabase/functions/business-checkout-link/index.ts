import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";

// Public exchange endpoint for the payment link emailed to an approved business.
//
// The email carries an application-scoped token (raw only in the email; we store
// just its sha256 on business_applications.checkout_token_hash). This function:
//   1. resolves the application from the token,
//   2. if the owner hasn't finished app signup yet the application has no linked
//      business, so it returns signup_required WITHOUT starting checkout,
//   3. otherwise mints a single-use billing_tokens row and hands off to the
//      audited stripe-create-checkout-session function (source "email"), which
//      keeps every existing guard (purchase_surface, live-mode, trial reuse),
//   4. returns the Stripe checkout URL for the page to redirect to.
//
// Errors are deliberately generic; internals are never exposed.

// This email token is exclusively for first activation. Existing trial, paid,
// lapsed, or suspended accounts use billing management/support instead.
const ELIGIBLE_STATUSES = new Set(["approved_not_activated"]);

// Abuse guard: cap how many checkout sessions a single business can spin up in a
// short window, so a leaked link can't hammer Stripe session creation.
const THROTTLE_WINDOW_MINUTES = 10;
const THROTTLE_MAX_PER_BUSINESS = 8;

// Short life for the internal billing token; it is consumed immediately by the
// self-call below and never leaves this function.
const BILLING_TOKEN_TTL_MINUTES = 30;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function tokenFromRequest(req: Request, payload: Record<string, unknown>): string {
  const fromPayload = typeof payload.token === "string" ? payload.token.trim() : "";
  if (fromPayload) return fromPayload;
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("token")?.trim() ?? "";
  if (fromQuery) return fromQuery;
  const segments = url.pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET") return {};
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
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
    return json(req, { ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { ok: false, error: "This link isn't available right now." }, 500);
    }

    const payload = await readPayload(req);
    const token = tokenFromRequest(req, payload);
    if (!token || token.length < 20) {
      return json(req, { ok: false, error: "This link isn't available." }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const tokenHash = await sha256Hex(token);

    const { data: application, error: applicationError } = await supabaseAdmin
      .from("business_applications")
      .select("id,business_id,status,checkout_token_expires_at")
      .eq("checkout_token_hash", tokenHash)
      .maybeSingle();
    if (applicationError) throw applicationError;

    if (!application) {
      return json(req, { ok: false, error: "This link isn't available." }, 404);
    }
    const expiresAt = application.checkout_token_expires_at
      ? new Date(String(application.checkout_token_expires_at)).getTime()
      : 0;
    if (!expiresAt || expiresAt <= Date.now()) {
      return json(req, { ok: false, reason: "expired", error: "This link has expired. Email support@twoferapp.com." }, 410);
    }
    if (!ELIGIBLE_STATUSES.has(String(application.status))) {
      return json(req, { ok: false, reason: "unavailable", error: "This trial is not open for checkout." }, 409);
    }

    const businessId = typeof application.business_id === "string" ? application.business_id : null;
    if (!businessId) {
      // Owner hasn't finished app signup, so the business isn't materialized yet.
      // Do not consume anything; tell the page to prompt signup and retry.
      return json(req, { ok: false, reason: "signup_required" });
    }

    // Per-business throttle before minting anything or touching Stripe.
    const windowStart = new Date(Date.now() - THROTTLE_WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count: recentTokens, error: throttleError } = await supabaseAdmin
      .from("billing_tokens")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("action", "subscription_checkout")
      .gte("created_at", windowStart);
    if (throttleError) throw throttleError;
    if ((recentTokens ?? 0) >= THROTTLE_MAX_PER_BUSINESS) {
      return json(req, { ok: false, reason: "rate_limited", error: "Too many attempts. Please try again in a few minutes." }, 429);
    }

    // Mint a single-use billing token, then reuse the audited checkout function.
    const rawBillingToken = randomToken();
    const billingTokenHash = await sha256Hex(rawBillingToken);
    const billingTokenExpiry = new Date(Date.now() + BILLING_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
    const { error: insertError } = await supabaseAdmin.from("billing_tokens").insert({
      business_id: businessId,
      token_hash: billingTokenHash,
      action: "subscription_checkout",
      max_uses: 1,
      use_count: 0,
      expires_at: billingTokenExpiry,
      metadata: { source: "approval_email", business_application_id: application.id },
    });
    if (insertError) throw insertError;

    const checkoutResponse = await fetch(`${supabaseUrl}/functions/v1/stripe-create-checkout-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        business_id: businessId,
        billing_token: rawBillingToken,
        source: "email",
      }),
    });
    const checkoutData = await checkoutResponse.json().catch(() => ({}));
    const checkoutUrl = typeof checkoutData?.checkout_url === "string" ? checkoutData.checkout_url : null;
    if (!checkoutResponse.ok || !checkoutUrl) {
      console.error(`[business-checkout-link] checkout session creation failed with status ${checkoutResponse.status}`);
      return json(req, { ok: false, reason: "unavailable", error: "Checkout isn't available right now. Email support@twoferapp.com." }, 502);
    }

    return json(req, { ok: true, url: checkoutUrl });
  } catch (error) {
    console.error("[business-checkout-link] error:", error instanceof Error ? error.message : String(error));
    return json(req, { ok: false, error: "This link isn't available right now." }, 500);
  }
});
