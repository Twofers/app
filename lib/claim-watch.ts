export type ClaimWatchEndKind = "redeemed" | "released" | "canceled" | "expired";

export type ClaimWatchRow = {
  redeemed_at?: string | null;
  claim_status?: string | null;
};

export type ClaimWatchResult =
  | { done: false }
  | { done: true; kind: ClaimWatchEndKind };

/**
 * Decide whether a polled `deal_claims` row has reached a terminal state that the
 * customer's open QR view should react to. `redeemed` covers a counter QR scan or the
 * in-app visual pass; the other kinds mean the claim ended without a redemption.
 *
 * Kept pure (no React, no supabase) so it can be unit tested; the polling glue lives in
 * hooks/use-claim-redeemed-watch.ts.
 */
export function classifyClaimWatchRow(row: ClaimWatchRow | null | undefined): ClaimWatchResult {
  if (!row) return { done: false };
  const status = typeof row.claim_status === "string" ? row.claim_status : null;
  if (row.redeemed_at || status === "redeemed") return { done: true, kind: "redeemed" };
  if (status === "released" || status === "canceled" || status === "expired") {
    return { done: true, kind: status };
  }
  return { done: false };
}
