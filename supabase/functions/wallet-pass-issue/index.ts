/**
 * Native wallet pass ("Twofer Card") — issue endpoint.
 * POST { platform: "google" | "apple", locale?: "en" | "es" | "ko" }
 *
 * Google: upserts the user's pass row + Wallet object and returns a fresh
 * "Save to Google Wallet" URL. Apple: 501 until the Phase 3 pkpass spike lands.
 * Gated by the NATIVE_WALLET_PASS_ENABLED secret (instant server kill switch).
 * Plan: docs/plans/native-wallet-pass-plan.md.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  isNativeWalletPassServerEnabled,
  issueGoogleWalletPass,
} from "../_shared/wallet-pass-sync.ts";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const json = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    /** Service role — wallet_passes is RLS default-deny; always scoped to the authenticated user. */
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized. Please log in." }, 401);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    if (!isNativeWalletPassServerEnabled()) {
      return json({ error: "Wallet passes are not available right now.", error_code: "feature_disabled" }, 403);
    }

    let body: { platform?: unknown; locale?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON in request body" }, 400);
    }

    if (body.platform === "apple") {
      return json(
        { error: "Apple Wallet support is coming soon.", error_code: "not_implemented" },
        501,
      );
    }
    if (body.platform !== "google") {
      return json({ error: "Missing or invalid platform" }, 400);
    }

    const result = await issueGoogleWalletPass(supabaseAdmin, user.id, body.locale);
    if (!result.ok) {
      const status = result.errorCode === "feature_disabled" ? 403 : result.errorCode === "not_configured" ? 503 : 502;
      return json(
        { error: "Wallet passes are not available right now.", error_code: result.errorCode },
        status,
      );
    }
    return json({ save_url: result.saveUrl }, 200);
  } catch (err) {
    console.error("[wallet-pass-issue] unexpected error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "Server error" }, 500);
  }
});
