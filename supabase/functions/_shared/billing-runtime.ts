export type PurchaseSurface = "disabled" | "in_app_link" | "web_only";

export type RuntimeBillingConfig = {
  purchaseSurface: PurchaseSurface;
  trialDealCreditAllowance: number;
  paidDealCreditAllowance: number;
  creditReservationTtlMinutes: number;
  billingEnvironment: "test" | "production";
  entitlementVersion: string;
  automaticTaxEnabled: boolean;
  twoferBusinessMonthlyPriceIdTest: string | null;
  twoferBusinessMonthlyPriceIdLive: string | null;
  /** false = self-serve checkout may skip card collection (payment_method_collection "if_required"). Dan-controlled toggle. */
  requireCardForTrial: boolean;
  /** Stripe subscription_data.trial_period_days granted when a checkout skips card collection. */
  noCardTrialDays: number;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: unknown) => {
        maybeSingle: () => PromiseLike<{ data: any; error: { message: string } | null }>;
      };
    };
  };
};

const PURCHASE_SURFACES = new Set(["disabled", "in_app_link", "web_only"]);

export function normalizePurchaseSurface(value: unknown): PurchaseSurface {
  return typeof value === "string" && PURCHASE_SURFACES.has(value) ? value as PurchaseSurface : "disabled";
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function normalizeBillingEnvironment(value: unknown): "test" | "production" {
  return value === "production" ? "production" : "test";
}

export async function loadRuntimeBillingConfig(
  supabase: SupabaseLike,
): Promise<RuntimeBillingConfig> {
  // Select * (this is a single pinned row, id=1) so newly-added columns don't
  // couple every billing function's config load to migration-vs-deploy order:
  // an explicit column list would make the whole load ERROR (and fall back to
  // purchaseSurface "disabled", breaking all checkout) if a function shipped
  // before a migration that adds a listed column. With *, a not-yet-migrated
  // column is simply absent and its field falls to the mapped default below.
  const { data, error } = await supabase
    .from("app_runtime_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return {
      purchaseSurface: "disabled",
      trialDealCreditAllowance: 30,
      paidDealCreditAllowance: 60,
      creditReservationTtlMinutes: 15,
      billingEnvironment: "test",
      entitlementVersion: "location-credit-v1",
      automaticTaxEnabled: false,
      twoferBusinessMonthlyPriceIdTest: null,
      twoferBusinessMonthlyPriceIdLive: null,
      // Fail closed if the config row can't be read: require a card.
      requireCardForTrial: true,
      noCardTrialDays: 30,
    };
  }

  return {
    purchaseSurface: normalizePurchaseSurface(data.purchase_surface),
    trialDealCreditAllowance: nonNegativeInt(data.trial_deal_credit_allowance, 30),
    paidDealCreditAllowance: nonNegativeInt(data.paid_deal_credit_allowance, 60),
    creditReservationTtlMinutes: nonNegativeInt(data.credit_reservation_ttl_minutes, 15),
    billingEnvironment: normalizeBillingEnvironment(data.billing_environment),
    entitlementVersion: safeGetString(data.entitlement_version) ?? "location-credit-v1",
    automaticTaxEnabled: data.automatic_tax_enabled === true,
    twoferBusinessMonthlyPriceIdTest: safeGetString(data.twofer_business_monthly_price_id_test),
    twoferBusinessMonthlyPriceIdLive: safeGetString(data.twofer_business_monthly_price_id_live),
    requireCardForTrial: data.require_card_for_trial === true,
    noCardTrialDays: nonNegativeInt(data.no_card_trial_days, 30) || 30,
  };
}

export function safeGetString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeStripeCheckoutLocale(value: unknown): "en" | "es-419" | "ko" {
  const raw = safeGetString(value)?.toLowerCase() ?? "";
  if (raw === "es-419" || raw.startsWith("es")) return "es-419";
  if (raw.startsWith("ko")) return "ko";
  return "en";
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
