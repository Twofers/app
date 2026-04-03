import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_PRO_PRICE_ID = Deno.env.get("STRIPE_PRO_PRICE_ID");
const APP_URL = Deno.env.get("APP_URL") ?? "twoforone://";

async function stripeApi(path: string, body: Record<string, string>): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe error: ${err.slice(0, 300)}`);
  }
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!STRIPE_SECRET_KEY || !STRIPE_PRO_PRICE_ID) {
    return new Response(JSON.stringify({ error: "Stripe not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // Get business + existing subscription
  const { data: biz } = await supabaseAdmin
    .from("businesses")
    .select("id, name")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!biz) {
    return new Response(JSON.stringify({ error: "No business found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: sub } = await supabaseAdmin
    .from("billing_subscriptions")
    .select("*")
    .eq("business_id", biz.id)
    .maybeSingle();

  // Get or create Stripe customer
  let customerId = sub?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripeApi("/customers", {
      email: user.email ?? "",
      name: biz.name,
      "metadata[business_id]": biz.id,
      "metadata[user_id]": user.id,
    });
    customerId = customer.id;

    // Save customer ID
    if (sub) {
      await supabaseAdmin
        .from("billing_subscriptions")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", sub.id);
    } else {
      await supabaseAdmin.from("billing_subscriptions").insert({
        business_id: biz.id,
        stripe_customer_id: customerId,
        plan_tier: "trial",
        status: "trialing",
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  }

  // Create Checkout Session
  const session = await stripeApi("/checkout/sessions", {
    customer: customerId!,
    mode: "subscription",
    "line_items[0][price]": STRIPE_PRO_PRICE_ID,
    "line_items[0][quantity]": "1",
    success_url: `${APP_URL}billing?success=1`,
    cancel_url: `${APP_URL}billing?canceled=1`,
    "metadata[business_id]": biz.id,
  });

  return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
