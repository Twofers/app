import { EDGE_FUNCTION_TIMEOUT_MS, parseFunctionError } from "@/lib/functions";
import { supabase } from "@/lib/supabase";

// Kept out of lib/functions.ts (a hash-locked AI-poster core file) so this consumer
// demand-capture path can evolve without tripping that gate — same rationale as
// lib/business-application.ts.

/**
 * A single row from `public-local-businesses`: either an already-onboarded
 * business or an unclaimed prospect seed record. `id` + `record_type` together
 * tell the caller which field to pass back into `requestBusinessOnTwofer`.
 */
export type LocalBusinessSearchResult = {
  id: string;
  record_type: "business" | "prospect";
  display_name: string;
  category: string | null;
  city: string | null;
  coarse_location: string | null;
  public_label_state: string | null;
};

function isLocalBusinessSearchResult(value: unknown): value is LocalBusinessSearchResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (row.record_type === "business" || row.record_type === "prospect") &&
    typeof row.display_name === "string"
  );
}

// Surfaces the server's JSON `{ error }` message on a non-2xx invoke, mirroring
// the reader in lib/functions.ts without exporting it (same pattern as
// lib/business-application.ts's local invokeErrorMessage).
async function invokeErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const data = await ctx.clone().json();
      const message = (data as { error?: unknown })?.error;
      if (typeof message === "string" && message) return message;
    } catch {
      /* body wasn't JSON — fall through to the generic parser */
    }
  }
  return parseFunctionError(error);
}

/**
 * Public, unauthenticated search over onboarded businesses AND unclaimed
 * prospect seed records (`public_local_businesses` RPC via the
 * `public-local-businesses` edge function). Both are dead-from-client today;
 * this is also the resolver `requestBusinessOnTwofer` needs, since the demand
 * signal RPC only accepts an existing `business_id`/`prospect_id`, never a
 * free-text name.
 */
export async function searchLocalBusinesses(
  query: string,
  opts?: { city?: string | null; limit?: number },
): Promise<LocalBusinessSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.functions.invoke("public-local-businesses", {
    body: { query: trimmed, city: opts?.city ?? null, limit: opts?.limit ?? 8 },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) {
    throw new Error(await invokeErrorMessage(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error?: string }).error ?? "Could not load local businesses."));
  }
  const rows = (data as { businesses?: unknown } | null)?.businesses;
  return Array.isArray(rows) ? rows.filter(isLocalBusinessSearchResult) : [];
}

export type RequestBusinessTarget = { businessId: string } | { prospectId: string };

export type RequestBusinessResult = {
  ok: boolean;
  /** true when a new demand signal was recorded. */
  saved: boolean;
  /** true when this exact (user, target, day) request already existed — not an error. */
  deduped: boolean;
};

/**
 * Records a "please bring this business to Twofer" demand signal via the
 * deployed-but-previously-unused `request-business-on-twofer` edge function.
 * Requires a signed-in user (server-checked) and exactly one of
 * `businessId`/`prospectId` — there is no free-text path server-side, so the
 * caller must resolve a target through `searchLocalBusinesses` first.
 */
export async function requestBusinessOnTwofer(
  target: RequestBusinessTarget,
  opts?: { sourceSurface?: string; zipCode?: string | null; radiusMiles?: number | null },
): Promise<RequestBusinessResult> {
  const body: Record<string, unknown> = {
    signal_type: "request",
    source_surface: opts?.sourceSurface ?? "app_consumer_home",
  };
  if ("businessId" in target) {
    body.business_id = target.businessId;
  } else {
    body.prospect_id = target.prospectId;
  }
  if (opts?.zipCode) body.zip_code = opts.zipCode;
  if (opts?.radiusMiles != null) body.radius_miles = opts.radiusMiles;

  const { data, error } = await supabase.functions.invoke("request-business-on-twofer", {
    body,
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) {
    throw new Error(await invokeErrorMessage(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error?: string }).error ?? "Could not save this request."));
  }
  const out = data as { ok?: boolean; saved?: boolean; deduped?: boolean } | null;
  return { ok: out?.ok === true, saved: out?.saved === true, deduped: out?.deduped === true };
}
