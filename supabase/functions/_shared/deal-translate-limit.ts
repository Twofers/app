// Monthly translation cap sized from the account's deal-credit allowance.
//
// Decision (Dan, 2026-07-01): the translate cap is 4x whatever the deal limit
// is for the account, so a business can never publish more deals than it has
// AI translations for. Resolution order:
//   1. AI_TRANSLATE_MONTHLY_LIMIT env var, when set to a positive number,
//      is an absolute override (operational escape hatch).
//   2. 4x the credits granted on the business's active deal_credit_periods
//      rows (summed across its locations).
//   3. 4x the configured trial deal-credit allowance from
//      get_runtime_billing_config() (default 30 -> cap 120).

export const DEAL_TRANSLATE_LIMIT_MULTIPLIER = 4;
export const DEFAULT_DEAL_CREDIT_ALLOWANCE = 30;

type AdminClientLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export async function resolveDealTranslateMonthlyLimit(
  admin: AdminClientLike,
  businessId: string,
): Promise<number> {
  const envValue = Number(Deno.env.get("AI_TRANSLATE_MONTHLY_LIMIT") ?? "");
  if (Number.isFinite(envValue) && envValue > 0) return envValue;

  let allowance = 0;
  try {
    const { data: locationRows } = await admin
      .from("business_locations")
      .select("id")
      .eq("business_id", businessId);
    const locationIds = (locationRows ?? [])
      .map((row: { id?: string | null }) => row?.id)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

    if (locationIds.length > 0) {
      const { data: periodRows } = await admin
        .from("deal_credit_periods")
        .select("credits_granted")
        .in("business_location_id", locationIds)
        .eq("status", "active");
      allowance = (periodRows ?? []).reduce(
        (sum: number, row: { credits_granted?: number | null }) => sum + (Number(row?.credits_granted) || 0),
        0,
      );
    }

    if (allowance <= 0) {
      const { data: configRows } = await admin.rpc("get_runtime_billing_config");
      const config = Array.isArray(configRows) ? configRows[0] : configRows;
      allowance = Number((config as { trial_deal_credit_allowance?: unknown } | null)?.trial_deal_credit_allowance) || 0;
    }
  } catch {
    allowance = 0;
  }

  return (allowance > 0 ? allowance : DEFAULT_DEAL_CREDIT_ALLOWANCE) * DEAL_TRANSLATE_LIMIT_MULTIPLIER;
}
