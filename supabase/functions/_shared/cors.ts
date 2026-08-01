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

// Production web origins (legal pages + web client). Always allowed.
const PROD_ORIGINS = [
  "https://twoferapp.com",
  "https://www.twoferapp.com",
] as const;

// Expo Go / dev-client local dev server. Web-attack review 2026-07-31, finding
// L-1: these must NOT be echoed in production, where a local process bound to
// those ports would otherwise get a same-origin-equivalent channel to every
// function. Opt in explicitly via ALLOW_LOCALHOST_CORS=true (set only in dev).
const DEV_ORIGINS = [
  "http://localhost:8081",
  "http://localhost:19006",
] as const;

function allowedOrigins(): Set<string> {
  const origins = new Set<string>(PROD_ORIGINS);
  if ((Deno.env.get("ALLOW_LOCALHOST_CORS") ?? "").toLowerCase() === "true") {
    for (const origin of DEV_ORIGINS) origins.add(origin);
  }
  return origins;
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowedOrigin =
    origin && allowedOrigins().has(origin) ? origin : null;

  return {
    // If origin is recognized, echo it. Otherwise omit the header so
    // credentialed browser requests from unknown origins are blocked.
    // Mobile (no origin header) is unaffected.
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    // We reflect one of several allowed origins, so caches must key on Origin
    // (L-2) or an intermediary could serve origin A's header to origin B.
    "Vary": "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}
