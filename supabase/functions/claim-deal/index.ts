import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // 🔐 Get authenticated user
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

    // 📦 Parse request body
    let body;
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

    const dealId = body.deal_id;

    if (!dealId) {
      return new Response(
        JSON.stringify({ error: "Missing deal_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🚦 Rate limit: max 3 claim attempts per minute per user
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { count: recentClaimCount } = await supabase
      .from("deal_claims")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", oneMinuteAgo);
    if (recentClaimCount !== null && recentClaimCount >= 3) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Try again in 30 seconds." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔍 Fetch and validate deal
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .select("id, business_id, start_time, end_time, claim_cutoff_buffer_minutes, max_claims, is_active, is_recurring, days_of_week, window_start_minutes, window_end_minutes, timezone")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return new Response(
        JSON.stringify({ error: "Deal not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!deal.is_active) {
      return new Response(
        JSON.stringify({ error: "This deal is not active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const now = new Date();
    const startTime = deal.start_time ? new Date(deal.start_time) : null;
    const endTime = new Date(deal.end_time);
    if (startTime && now < startTime) {
      return new Response(
        JSON.stringify({ error: "This deal has not started yet." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    const cutoffBufferMinutes = deal.claim_cutoff_buffer_minutes || 15;
    const claimCutoffTime = new Date(endTime.getTime() - cutoffBufferMinutes * 60 * 1000);

    if (now >= endTime) {
      return new Response(
        JSON.stringify({ error: "This deal has expired" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (now >= claimCutoffTime) {
      return new Response(
        JSON.stringify({
          error: `Claiming has closed. Cutoff was ${claimCutoffTime.toLocaleString()}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ⏰ Recurring window validation
    if (deal.is_recurring) {
      const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
      const windowStart = deal.window_start_minutes;
      const windowEnd = deal.window_end_minutes;
      const tz = deal.timezone || "America/Chicago";

      if (!days.length || windowStart == null || windowEnd == null) {
        return new Response(
          JSON.stringify({ error: "This deal is not configured correctly." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);

      const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
      const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
      const minutesNow = hour * 60 + minute;

      const dayMap: Record<string, number> = {
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        Sun: 7,
      };
      const today = dayMap[weekday] ?? 1;

      if (!days.includes(today)) {
        return new Response(
          JSON.stringify({ error: "This deal is not active today." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (windowStart >= windowEnd) {
        return new Response(
          JSON.stringify({ error: "This deal has an invalid time window." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const cutoffMinutes = windowEnd - cutoffBufferMinutes;
      if (minutesNow < windowStart || minutesNow >= windowEnd) {
        return new Response(
          JSON.stringify({ error: "This deal is not active right now." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (minutesNow >= cutoffMinutes) {
        return new Response(
          JSON.stringify({ error: "Claiming has closed for today's window." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // 🚫 Check for existing active claim (one per user per deal)
    const { data: existingClaims, error: existingError } = await supabase
      .from("deal_claims")
      .select("id, token, expires_at, redeemed_at")
      .eq("deal_id", dealId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingClaims && existingClaims.length > 0) {
      const existingClaim = existingClaims[0];
      if (!existingClaim.redeemed_at) {
        const existingExpires = new Date(existingClaim.expires_at);
        if (existingExpires > now) {
          // Return existing active token
          return new Response(
            JSON.stringify({
              token: existingClaim.token,
              expires_at: existingClaim.expires_at,
              message: "You already have an active claim for this deal",
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
    }

    // 📊 Check max_claims limit (count all claims, not just redeemed)
    if (deal.max_claims !== null && deal.max_claims > 0) {
      const { count, error: countError } = await supabase
        .from("deal_claims")
        .select("*", { count: "exact", head: true })
        .eq("deal_id", dealId);

      if (countError) {
        console.error("Error counting claims:", countError);
      } else if (count !== null && count >= deal.max_claims) {
        return new Response(
          JSON.stringify({ error: "This deal has reached its claim limit." }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // ⏱ Generate token with expiration based on deal end time
    const token = crypto.randomUUID();
    // Token expires at claim cutoff time (not deal end time)
    const expiresAt = claimCutoffTime.toISOString();

    // 🧾 Insert claim
    const { error: insertError } = await supabase
      .from("deal_claims")
      .insert({
        deal_id: dealId,
        user_id: user.id,
        token,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      // Check for unique constraint violation (one active claim per user per deal)
      if (insertError.code === "23505") {
        return new Response(
          JSON.stringify({ error: "You already have an active claim for this deal" }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      return new Response(
        JSON.stringify({ error: `Failed to create claim: ${insertError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ✅ Success
    return new Response(
      JSON.stringify({
        token,
        expires_at: expiresAt,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({
        error: "Server error",
        details: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
