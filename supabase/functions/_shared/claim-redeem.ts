import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Redeem allowed until `expires_at` + grace (minutes). `expires_at` is the concrete instance end. */
export function redeemDeadlineMs(expiresAtIso: string, graceMinutes: number): number {
  const g = Number.isFinite(graceMinutes) && graceMinutes > 0 ? graceMinutes : 10;
  return new Date(expiresAtIso).getTime() + g * 60 * 1000;
}

export function isPastRedeemDeadline(
  nowMs: number,
  expiresAtIso: string,
  graceMinutes: number,
): boolean {
  return nowMs >= redeemDeadlineMs(expiresAtIso, graceMinutes);
}

/** After Use Deal starts, auto-complete to redeemed this many ms after `redeem_started_at`. */
export const VISUAL_REDEEM_AUTO_FINALIZE_MS = 30_000;

/** Idempotent: redeeming + started ≥ TTL → redeemed (visual). Returns true if this claim was finalized. */
export async function finalizeStaleVisualRedeemForClaim(
  supabase: SupabaseClient,
  claimId: string,
  nowIso: string,
): Promise<boolean> {
  const { data: row } = await supabase
    .from("deal_claims")
    .select("id, claim_status, redeem_started_at, redeemed_at, expires_at, grace_period_minutes")
    .eq("id", claimId)
    .maybeSingle();
  if (!row || row.redeemed_at) return false;
  if (row.claim_status !== "redeeming" || !row.redeem_started_at) return false;
  const started = new Date(String(row.redeem_started_at)).getTime();
  const now = new Date(nowIso).getTime();
  if (now - started < VISUAL_REDEEM_AUTO_FINALIZE_MS) return false;

  if (row.expires_at) {
    const grace = typeof row.grace_period_minutes === "number" ? row.grace_period_minutes : 10;
    if (isPastRedeemDeadline(now, String(row.expires_at), grace)) {
      await supabase
        .from("deal_claims")
        .update({ claim_status: "expired", redeem_started_at: null })
        .eq("id", claimId)
        .eq("claim_status", "redeeming")
        .is("redeemed_at", null);
      return false;
    }
  }

  const { data: upd } = await supabase
    .from("deal_claims")
    .update({
      redeemed_at: nowIso,
      claim_status: "redeemed",
      redeem_method: "visual",
      redeem_started_at: null,
    })
    .eq("id", claimId)
    .eq("claim_status", "redeeming")
    .is("redeemed_at", null)
    .select("id")
    .maybeSingle();
  return !!upd;
}
