import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  evaluateRepeatClaimPolicy,
  normalizeRepeatClaimPolicyType,
  type RepeatClaimPolicyType,
} from "./repeat-claim-policy.ts";

type DbClient = SupabaseClient<any, any, any, any, any>;

/**
 * Notification-audience filter for business repeat-claim limits.
 *
 * A business can restrict repeat customers (Account → repeat-claim settings):
 * FOREVER (first-timers only) or COOLDOWN_DAYS. `claim-deal` enforces that at
 * claim time and the consumer feed already hides those deals
 * (`lib/repeat-claim-visibility.ts`), but the push senders did not check it — so
 * a blocked customer got a "new deal" push, tapped it, and hit a Claim button
 * that could never succeed. This module is the shared filter, deliberately
 * evaluated with the same `evaluateRepeatClaimPolicy` the claim gate uses so the
 * two can never drift apart.
 *
 * Only *policy* blocks are filtered. A customer who merely holds an active claim
 * right now is NOT filtered: that is temporary, they can redeem or release and
 * then claim this deal, so they still deserve to hear about it.
 *
 * Fails OPEN. Every lookup failure degrades to "notify everyone" (today's
 * behavior) rather than silencing an entire release, mirroring the philosophy
 * documented in `lib/repeat-claim-visibility.ts`.
 */

/** Stable key for a (customer, business) pair. */
export function repeatBlockKey(userId: string, businessId: string): string {
  return `${userId}::${businessId}`;
}

export type RepeatPolicyByBusiness = Map<
  string,
  { policyType: RepeatClaimPolicyType; cooldownDays: number | null }
>;

export type RedemptionRow = {
  user_id: string;
  business_id: string;
  redeemed_at: string;
};

/**
 * Pure core: which (customer, business) pairs are currently blocked.
 *
 * `redemptions` must be ordered newest-first; the first row seen for a pair wins,
 * which is what makes a single ordered query enough for the whole audience.
 */
export function selectRepeatBlockedPairs(params: {
  policiesByBusinessId: RepeatPolicyByBusiness;
  redemptions: RedemptionRow[];
  nowMs: number;
}): Set<string> {
  const blocked = new Set<string>();
  const seen = new Set<string>();

  for (const row of params.redemptions) {
    if (!row?.user_id || !row?.business_id || !row?.redeemed_at) continue;
    const key = repeatBlockKey(row.user_id, row.business_id);
    if (seen.has(key)) continue; // older redemption for a pair we already judged
    seen.add(key);

    const policy = params.policiesByBusinessId.get(row.business_id);
    if (!policy || policy.policyType === "NONE") continue;

    const verdict = evaluateRepeatClaimPolicy({
      policyType: policy.policyType,
      cooldownDays: policy.cooldownDays,
      lastRedeemedAt: row.redeemed_at,
      nowMs: params.nowMs,
    });
    if (verdict) blocked.add(key);
  }

  return blocked;
}

/** PostgREST `.in()` builds a URL; chunk so a large audience can't 414 into a silent fail-open. */
const USER_CHUNK = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Businesses among `businessIds` that actually restrict repeat customers. */
async function loadRestrictivePolicies(
  admin: DbClient,
  businessIds: string[],
): Promise<RepeatPolicyByBusiness> {
  const policies: RepeatPolicyByBusiness = new Map();
  const { data, error } = await admin
    .from("businesses")
    .select("id,repeat_claim_policy_type,repeat_claim_cooldown_days")
    .in("id", businessIds);
  if (error) {
    console.error("[repeat-claim-audience] policy lookup failed (fail-open):", error);
    return policies;
  }
  for (const row of (data ?? []) as {
    id: string;
    repeat_claim_policy_type?: string | null;
    repeat_claim_cooldown_days?: number | null;
  }[]) {
    const policyType = normalizeRepeatClaimPolicyType(row.repeat_claim_policy_type);
    if (policyType === "NONE") continue; // common case: nothing to filter
    policies.set(row.id, {
      policyType,
      cooldownDays: typeof row.repeat_claim_cooldown_days === "number"
        ? row.repeat_claim_cooldown_days
        : null,
    });
  }
  return policies;
}

/**
 * Blocked (customer, business) pairs for the given audience. Test membership with
 * `repeatBlockKey(userId, businessId)`. Returns an empty set when nothing is
 * restricted or on any lookup failure (fail-open).
 */
export async function loadRepeatBlockedPairs(
  admin: DbClient,
  businessIds: string[],
  userIds: string[],
  nowMs: number = Date.now(),
): Promise<Set<string>> {
  const businesses = Array.from(new Set(businessIds.filter(Boolean)));
  const users = Array.from(new Set(userIds.filter(Boolean)));
  if (businesses.length === 0 || users.length === 0) return new Set();

  try {
    const policiesByBusinessId = await loadRestrictivePolicies(admin, businesses);
    if (policiesByBusinessId.size === 0) return new Set();

    // Only restricted businesses need a redemption history lookup.
    const restrictedIds = [...policiesByBusinessId.keys()];
    const redemptions: RedemptionRow[] = [];
    for (const batch of chunk(users, USER_CHUNK)) {
      const { data, error } = await admin
        .from("deal_claims")
        .select("user_id,business_id,redeemed_at")
        .in("user_id", batch)
        .in("business_id", restrictedIds)
        .eq("claim_status", "redeemed")
        .not("redeemed_at", "is", null)
        .order("redeemed_at", { ascending: false });
      if (error) {
        console.error("[repeat-claim-audience] redemption lookup failed (fail-open):", error);
        return new Set();
      }
      redemptions.push(...((data ?? []) as RedemptionRow[]));
    }

    return selectRepeatBlockedPairs({ policiesByBusinessId, redemptions, nowMs });
  } catch (err) {
    console.error("[repeat-claim-audience] unexpected failure (fail-open):", err);
    return new Set();
  }
}

/**
 * Convenience wrapper for the single-business case (`send-deal-push`): the
 * subset of `userIds` still allowed to hear about this business's deals.
 */
export async function filterRepeatBlockedUserIds(
  admin: DbClient,
  businessId: string,
  userIds: string[],
  nowMs: number = Date.now(),
): Promise<string[]> {
  const blocked = await loadRepeatBlockedPairs(admin, [businessId], userIds, nowMs);
  if (blocked.size === 0) return userIds;
  return userIds.filter((userId) => !blocked.has(repeatBlockKey(userId, businessId)));
}
