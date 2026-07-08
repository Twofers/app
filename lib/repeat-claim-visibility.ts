import { supabase } from "@/lib/supabase";

/**
 * Client-side visibility helpers for business repeat-claim limits.
 *
 * A business can limit repeat customers (Account → repeat-claim settings):
 *   - NONE          : no limit
 *   - COOLDOWN_DAYS : one redemption, then blocked until N days after that redemption
 *   - FOREVER       : first-time customers only; blocked after any prior redemption
 *
 * The authoritative enforcement lives in the claim-deal edge function
 * (supabase/functions/_shared/repeat-claim-policy.ts). These helpers mirror that
 * logic purely to HIDE deals a customer cannot currently claim, so they never hit a
 * dead-end "you're restricted" error. This is presentation only — if any lookup here
 * fails or the columns are absent, we fall back to showing the deal and the server
 * still blocks the claim.
 */

export type RepeatClaimPolicyType = "NONE" | "COOLDOWN_DAYS" | "FOREVER";

export type RepeatPolicyFields = {
  repeat_claim_policy_type?: string | null;
  repeat_claim_cooldown_days?: number | null;
};

export function normalizeRepeatClaimPolicyType(value: unknown): RepeatClaimPolicyType {
  return value === "COOLDOWN_DAYS" || value === "FOREVER" ? value : "NONE";
}

/**
 * Boolean mirror of evaluateRepeatClaimPolicy: true when the customer is currently
 * blocked from claiming at this business given their last redemption there.
 */
export function isRepeatClaimBlocked(params: {
  policyType: RepeatClaimPolicyType;
  cooldownDays: number | null;
  lastRedeemedAt: string | null;
  nowMs: number;
}): boolean {
  if (params.policyType === "NONE" || !params.lastRedeemedAt) return false;
  if (params.policyType === "FOREVER") return true;

  const redeemedAtMs = Date.parse(params.lastRedeemedAt);
  const cooldownDays = params.cooldownDays ?? 0;
  if (!Number.isFinite(redeemedAtMs) || cooldownDays < 1) return false;

  const nextEligibleAtMs = redeemedAtMs + cooldownDays * 24 * 60 * 60 * 1000;
  return params.nowMs < nextEligibleAtMs;
}

/** True when this deal's business currently restricts this customer, so it should be hidden. */
export function isDealHiddenByRepeatPolicy(params: {
  policy: RepeatPolicyFields | null | undefined;
  lastRedeemedAt: string | null;
  nowMs: number;
}): boolean {
  const policyType = normalizeRepeatClaimPolicyType(params.policy?.repeat_claim_policy_type);
  if (policyType === "NONE") return false;
  return isRepeatClaimBlocked({
    policyType,
    cooldownDays: params.policy?.repeat_claim_cooldown_days ?? null,
    lastRedeemedAt: params.lastRedeemedAt,
    nowMs: params.nowMs,
  });
}

/**
 * Loads repeat-claim policy per business. Returns an empty map on any error (missing
 * columns, RLS, network) so callers degrade to showing everything.
 */
export async function loadBusinessRepeatPolicies(
  businessIds: string[],
): Promise<Map<string, RepeatPolicyFields>> {
  const map = new Map<string, RepeatPolicyFields>();
  const ids = Array.from(new Set(businessIds.filter(Boolean)));
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from("businesses")
    .select("id,repeat_claim_policy_type,repeat_claim_cooldown_days")
    .in("id", ids);
  if (error || !data) return map;

  for (const row of data as {
    id: string;
    repeat_claim_policy_type?: string | null;
    repeat_claim_cooldown_days?: number | null;
  }[]) {
    map.set(row.id, {
      repeat_claim_policy_type: row.repeat_claim_policy_type ?? null,
      repeat_claim_cooldown_days: row.repeat_claim_cooldown_days ?? null,
    });
  }
  return map;
}

/**
 * Loads the customer's most-recent successful redemption timestamp per business,
 * scoped to the given businesses. Ordered newest-first so the first row per business
 * wins. Returns an empty map on any error so callers degrade to showing everything.
 */
export async function loadBusinessRedemptionMap(
  userId: string | null,
  businessIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!userId) return map;
  const ids = Array.from(new Set(businessIds.filter(Boolean)));
  if (ids.length === 0) return map;

  const { data, error } = await supabase
    .from("deal_claims")
    .select("business_id,redeemed_at")
    .eq("user_id", userId)
    .eq("claim_status", "redeemed")
    .not("redeemed_at", "is", null)
    .in("business_id", ids)
    .order("redeemed_at", { ascending: false });
  if (error || !data) return map;

  for (const row of data as { business_id: string | null; redeemed_at: string | null }[]) {
    const bid = row.business_id;
    const at = row.redeemed_at;
    if (!bid || !at) continue;
    if (!map.has(bid)) map.set(bid, at);
  }
  return map;
}
