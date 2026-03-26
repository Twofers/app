export type MerchantInsightsRow = {
  claims: number;
  redeems: number;
  expired_unredeemed: number;
  avg_claim_to_redeem_seconds: number | null;
  new_customer_claims: number;
  returning_customer_claims: number;
  age_band_mix: Record<string, number>;
  zip_cluster_mix: Record<string, number>;
  acquisition_mix: Record<string, number>;
  redeem_method_mix: Record<string, number>;
  claim_blocked_reason_mix: Record<string, number>;
  claims_by_hour_local: number[];
};

export function parseMerchantInsights(raw: unknown): MerchantInsightsRow | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const num = (k: string) => (typeof o[k] === "number" ? o[k] : Number(o[k]));
  const arr = o.claims_by_hour_local;
  const hours = Array.isArray(arr) ? arr.map((x) => (typeof x === "number" ? x : Number(x))) : [];
  return {
    claims: num("claims") || 0,
    redeems: num("redeems") || 0,
    expired_unredeemed: num("expired_unredeemed") || 0,
    avg_claim_to_redeem_seconds: o.avg_claim_to_redeem_seconds == null ? null : num("avg_claim_to_redeem_seconds"),
    new_customer_claims: num("new_customer_claims") || 0,
    returning_customer_claims: num("returning_customer_claims") || 0,
    age_band_mix: (o.age_band_mix as Record<string, number>) ?? {},
    zip_cluster_mix: (o.zip_cluster_mix as Record<string, number>) ?? {},
    acquisition_mix: (o.acquisition_mix as Record<string, number>) ?? {},
    redeem_method_mix: (o.redeem_method_mix as Record<string, number>) ?? {},
    claim_blocked_reason_mix: (o.claim_blocked_reason_mix as Record<string, number>) ?? {},
    claims_by_hour_local: hours.length === 24 ? hours : Array.from({ length: 24 }, (_, i) => hours[i] ?? 0),
  };
}
