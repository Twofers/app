/**
 * Shared CORS headers for Supabase Edge Functions.
 *
 * Mobile clients (React Native) don't send an Origin header, so we still need
 * a permissive CORS policy. However, we restrict to known origins when present
 * to prevent browser-based CSRF from arbitrary websites.
 *
 * Most app endpoints still require a valid Supabase JWT. Public web endpoints
 * must add their own validation and abuse controls in addition to CORS.
 */

const ALLOWED_ORIGINS = new Set([
  // Expo Go / dev-client local dev server
  "http://localhost:8081",
  "http://localhost:19006",
  // Production web (legal pages + future web client)
  "https://twoferapp.com",
  "https://www.twoferapp.com",
]);

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowedOrigin =
    origin && ALLOWED_ORIGINS.has(origin) ? origin : null;

  return {
    // If origin is recognized, echo it. Otherwise omit the header so
    // credentialed browser requests from unknown origins are blocked.
    // Mobile (no origin header) is unaffected.
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}
