import { supabase } from "@/lib/supabase";
import { beginVisualRedeem, EDGE_FUNCTION_TIMEOUT_MS, parseFunctionError } from "@/lib/functions";

/**
 * Manual "staff can't scan it" redemption.
 *
 * The customer double-taps the QR and confirms; the claim is marked redeemed
 * from their own device. This is a deliberate, Dan-accepted trust trade-off
 * (2026-07-25): a customer could burn a claim away from the counter, but that
 * only forfeits their own reward — they still don't get the food. The server
 * stamps `redeemed_at_location_id` and writes a `redemptions` audit row, and the
 * claim keeps `redeem_method = 'visual'`, so manual redemptions stay
 * distinguishable from scanned ones in merchant reporting.
 *
 * Lives outside `lib/functions.ts` because that file is under the AI poster core
 * lock; the wrapper there can't gain the `manual` flag without its own approval.
 */
export type ManualRedeemResult = {
  ok: boolean;
  already_redeemed?: boolean;
  redeemed_at: string;
};

/**
 * Completes a visual redemption immediately, skipping the legacy countdown's
 * 14s pacing wait (`manual: true`). Starts the redemption first when needed —
 * `begin-visual-redeem` is idempotent and returns `resumed` for a claim already
 * in `redeeming`, so this is safe to call from either state.
 */
export async function manualRedeemClaim(claimId: string): Promise<ManualRedeemResult> {
  await beginVisualRedeem(claimId);

  const { data, error } = await supabase.functions.invoke("complete-visual-redeem", {
    body: { claim_id: claimId, manual: true },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(parseFunctionError(error));
  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as { error?: string }).error ?? "Server returned an error");
  }
  return data as ManualRedeemResult;
}
