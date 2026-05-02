/**
 * Shared Supabase client constructors for edge functions.
 *
 * The defensive principle: when forwarding a user's JWT for `auth.getUser()` or RLS-enforced
 * reads/writes, use the ANON key (not the SERVICE_ROLE key). The ANON key only authenticates
 * the project; the user's JWT determines identity for RLS. Forwarding SERVICE_ROLE alongside
 * a user JWT relies on Supabase JS preferring the JWT — historically true, but a future
 * client-library change in header precedence could silently turn every "user-scoped" client
 * into a service-role client.
 *
 * Reserve `adminClient()` for explicitly privileged operations (cross-tenant queries, audit
 * logging, RLS-bypass writes) where the function has already verified authorization.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Build a Supabase client scoped to the calling user's JWT. Uses the ANON key + the
 * user's Authorization header, so RLS applies normally.
 *
 * Use for:
 *   - `auth.getUser()` to identify the caller
 *   - Reads/writes that should respect RLS (caller can only see/modify their own rows)
 */
export function userClient(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY not configured");
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Build a Supabase client with the service-role key (RLS bypass). Use ONLY after the
 * function has verified the caller is authorized for the operation being performed.
 *
 * Use for:
 *   - Cross-tenant queries (rate limits, brute-force counters, analytics rollups)
 *   - Writes the user's RLS would block but the function legitimately needs (audit logs)
 *   - Privileged operations like `auth.admin.deleteUser`
 */
export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
