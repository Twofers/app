import type { SupabaseClient } from "@supabase/supabase-js";

export type SubscriptionPricing = {
  proMonthlyPrice: number;
  premiumMonthlyPrice: number;
  extraLocationPrice: number;
};

/**
 * Load tier pricing from `app_config` (v4 billing).
 * Pricing is required for checkout session creation; never hard-code amounts in the app.
 */
export async function loadSubscriptionPricingFromAppConfig(
  supabase: SupabaseClient,
): Promise<SubscriptionPricing> {
  const { data, error } = await supabase
    .from("app_config")
    .select("pro_monthly_price,premium_monthly_price,extra_location_price")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Missing app_config row.");

  return {
    proMonthlyPrice: Number(data.pro_monthly_price),
    premiumMonthlyPrice: Number(data.premium_monthly_price),
    extraLocationPrice: Number(data.extra_location_price),
  };
}

