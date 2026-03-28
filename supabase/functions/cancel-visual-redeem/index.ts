import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Visual redemption intentionally cannot be canceled. Once the live pass
 * begins, the deal is considered used. If the consumer closes the app
 * mid-flow, `finalize-stale-redeems` will auto-complete it server-side
 * within a few minutes. The wallet screen handles the "redeeming" state
 * by showing a "Continue at counter" button so the user can resume.
 *
 * Returning 400 is the documented/expected behaviour.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error:
        "Redemption cannot be canceled after it starts. If you closed the pass, it will complete automatically shortly.",
      error_code: "CANCEL_NOT_SUPPORTED",
    }),
    {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
