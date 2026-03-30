export type SubscriptionPricing = {
  proMonthlyPrice: number;
  premiumMonthlyPrice: number;
  extraLocationPrice: number;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      maybeSingle: () => Promise<{ data: any; error: { message: string } | null }>;
    };
  };
};

/**
 * Load tier pricing from `app_config` (v4 billing).
 * Used by Stripe checkout session creation.
 */
export async function loadSubscriptionPricingFromAppConfig(
  supabase: SupabaseLike,
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

