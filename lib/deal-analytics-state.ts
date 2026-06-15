type DealAnalyticsClaimLike = {
  redeemed_at?: string | null;
};

export function getDealAnalyticsActivityState(claims: readonly DealAnalyticsClaimLike[]) {
  const claimCount = claims.length;
  const redemptionCount = claims.filter((claim) => Boolean(claim.redeemed_at)).length;

  return {
    claimCount,
    redemptionCount,
    hasTimelineData: claimCount > 0,
    canExport: claimCount > 0,
  };
}
