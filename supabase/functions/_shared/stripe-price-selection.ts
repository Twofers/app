type Tier = "pro" | "premium";

type StripePriceLike = {
  id: string;
  unit_amount: number | null;
  lookup_key?: string | null;
  recurring?: { interval?: string | null } | null;
};

export function selectMonthlyTierPriceId(params: {
  tier: Tier;
  targetCents: number;
  prices: StripePriceLike[];
}): string | null {
  const monthly = params.prices.filter((price) => {
    return price.recurring?.interval === "month" && price.unit_amount === params.targetCents;
  });
  if (monthly.length === 0) return null;

  const expectedLookupKey = `twofer_${params.tier}_monthly`;
  const exactMatches = monthly.filter((price) => price.lookup_key === expectedLookupKey);
  if (exactMatches.length === 1) return exactMatches[0]?.id ?? null;
  if (exactMatches.length > 1) return null;

  if (monthly.length === 1) return monthly[0]?.id ?? null;

  return null;
}
