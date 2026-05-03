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

    /**
     * Deleting the auth user cascades through the schema automatically —
     *   businesses.owner_id → ON DELETE CASCADE
     *   deals.business_id → ON DELETE CASCADE
     *   deal_claims.user_id / deal_id → ON DELETE CASCADE
     *   business_profiles.user_id / owner_id → ON DELETE CASCADE
     *   business_menu_items.business_id → ON DELETE CASCADE (via businesses)
     *   deal_templates.business_id → ON DELETE CASCADE (via businesses)
     *   consumer_profiles.user_id → ON DELETE CASCADE
     *   profiles.id → ON DELETE CASCADE
     *   push_tokens.user_id → ON DELETE CASCADE
     *   favorites (user_id, business_id) → ON DELETE CASCADE
     *   analytics_events.user_id → ON DELETE SET NULL (anonymized retention)
     *
     * Apple (5.1.1.v) and Google both require account deletion to complete
     * inside the app — the previous "block business owners → contact support"
     * branch was a documented rejection trigger and has been removed.
     */
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (delErr) {
      console.error("delete-user-account error:", delErr);
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
