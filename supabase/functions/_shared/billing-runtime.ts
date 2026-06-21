export type PurchaseSurface = "disabled" | "in_app_link" | "web_only";

export type RuntimeBillingConfig = {
  purchaseSurface: PurchaseSurface;
  trialDealCreditAllowance: number;
  paidDealCreditAllowance: number;
  creditReservationTtlMinutes: number;
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

export async function loadRuntimeBillingConfig(
  supabase: SupabaseLike,
): Promise<RuntimeBillingConfig> {
  const { data, error } = await supabase
    .from("app_runtime_config")
    .select("purchase_surface,trial_deal_credit_allowance,paid_deal_credit_allowance,credit_reservation_ttl_minutes")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return {
      purchaseSurface: "disabled",
      trialDealCreditAllowance: 30,
      paidDealCreditAllowance: 60,
      creditReservationTtlMinutes: 15,
    };
  }

  return {
    purchaseSurface: normalizePurchaseSurface(data.purchase_surface),
    trialDealCreditAllowance: nonNegativeInt(data.trial_deal_credit_allowance, 30),
    paidDealCreditAllowance: nonNegativeInt(data.paid_deal_credit_allowance, 60),
    creditReservationTtlMinutes: nonNegativeInt(data.credit_reservation_ttl_minutes, 15),
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
