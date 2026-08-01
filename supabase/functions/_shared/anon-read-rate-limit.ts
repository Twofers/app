// Web-attack review 2026-07-31, finding M-5.
//
// Several unauthenticated read/telemetry endpoints had no per-IP throttle, so
// each was a cheap request-flood amplifier (one DB round trip per call). This
// helper adds the same hashed-IP + global-ceiling limiter the public write
// endpoints use (consume_anonymous_endpoint_attempt), but FAILS OPEN: these
// endpoints serve public, RLS-scoped data, so the cap is DoS mitigation, not an
// authorization control — a missing abuse secret or an RPC error must never take
// the endpoint down. It only ever returns limited=true when the RPC positively
// reports the caller is over budget.

import { anonymousRequestActorHash } from "./anonymous-request-hash.ts";

export async function enforceAnonReadRateLimit(
  admin: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  req: Request,
  opts: {
    surface: string;
    actorLimit: number;
    globalLimit: number;
    windowSeconds: number;
  },
): Promise<{ limited: boolean }> {
  const actorHash = await anonymousRequestActorHash(req);
  // Abuse secret not configured — fail open (no throttle) rather than break a
  // public read.
  if (!actorHash) return { limited: false };

  const { data: allowed, error } = await admin.rpc("consume_anonymous_endpoint_attempt", {
    p_surface: opts.surface,
    p_actor_hash: actorHash,
    p_actor_limit: opts.actorLimit,
    p_global_limit: opts.globalLimit,
    p_window_seconds: opts.windowSeconds,
  });

  // Limiter itself errored — fail open, but leave a breadcrumb (code+message
  // only, never the raw error object).
  if (error) {
    const e = error as { code?: string; message?: string };
    console.error(`[${opts.surface}] anon read rate limit failed:`, e.code ?? "", e.message ?? "");
    return { limited: false };
  }

  return { limited: allowed !== true };
}
