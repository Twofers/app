import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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
  const corsHeaders = getCorsHeaders(req);

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
