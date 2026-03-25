import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Visual redemption cannot be rolled back to active; stale sessions auto-complete server-side. */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error:
        "Redemption cannot be canceled after it starts. If you closed the pass, it will complete automatically shortly.",
    }),
    {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
