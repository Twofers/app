export type RepeatClaimPolicyType = "NONE" | "COOLDOWN_DAYS" | "FOREVER";

export type RepeatClaimPolicyBlock =
  | {
      errorCode: "BUSINESS_REPEAT_LIMIT_FOREVER";
      message: string;
    }
  | {
      errorCode: "BUSINESS_REPEAT_LIMIT_COOLDOWN";
      message: string;
      nextEligibleAt: string;
    };

export function normalizeRepeatClaimPolicyType(value: unknown): RepeatClaimPolicyType {
  return value === "COOLDOWN_DAYS" || value === "FOREVER" ? value : "NONE";
}

export function evaluateRepeatClaimPolicy(params: {
  policyType: RepeatClaimPolicyType;
  cooldownDays: number | null;
  lastRedeemedAt: string | null;
  nowMs: number;
}): RepeatClaimPolicyBlock | null {
  if (params.policyType === "NONE" || !params.lastRedeemedAt) return null;

  if (params.policyType === "FOREVER") {
    return {
      errorCode: "BUSINESS_REPEAT_LIMIT_FOREVER",
      message: "This business limits deals to first-time Twofer customers. You have already redeemed a deal here.",
    };
  }

  const redeemedAtMs = Date.parse(params.lastRedeemedAt);
  const cooldownDays = params.cooldownDays ?? 0;
  if (!Number.isFinite(redeemedAtMs) || cooldownDays < 1) return null;

  const nextEligibleAtMs = redeemedAtMs + cooldownDays * 24 * 60 * 60 * 1000;
  if (params.nowMs >= nextEligibleAtMs) return null;

  const nextEligibleAt = new Date(nextEligibleAtMs).toISOString();
  return {
    errorCode: "BUSINESS_REPEAT_LIMIT_COOLDOWN",
    message: `You can claim another deal from this business on ${nextEligibleAt}.`,
    nextEligibleAt,
  };
}
