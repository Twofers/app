import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const blocked = {
      error:
        "This login is linked to a business profile. Contact support before deleting your account.",
      code: "BUSINESS_OWNER_DELETE_BLOCKED",
    };

    const { count, error: bizCountErr } = await supabaseAdmin
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id);

    if (bizCountErr) {
      console.error("delete-user-account: biz lookup failed:", bizCountErr);
      return new Response(
        JSON.stringify({
          error: "Could not verify account type. Try again in a moment.",
          code: "INTERNAL",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (count != null && count > 0) {
      return new Response(JSON.stringify(blocked), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Purge consumer data BEFORE deleting the auth row.
    // The purge_user_data RPC anonymizes claim/analytics history (preserves merchant
    // dashboards) and hard-deletes user-only tables (favorites, push_tokens,
    // consumer_profiles, consumer_push_prefs).
    const { error: purgeErr } = await supabaseAdmin.rpc("purge_user_data", {
      p_user_id: user.id,
    });
    if (purgeErr) {
      console.error("delete-user-account: purge_user_data failed:", purgeErr);
      return new Response(
        JSON.stringify({
          error: "Could not purge account data. Please contact support.",
          code: "PURGE_FAILED",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (delErr) {
      console.error("delete-user-account: auth delete failed:", delErr);
      return new Response(JSON.stringify({ error: "Could not delete account. Please contact support." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
