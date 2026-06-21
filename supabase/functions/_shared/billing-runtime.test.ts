import { describe, expect, it } from "vitest";

import {
  loadRuntimeBillingConfig,
  normalizePurchaseSurface,
  normalizeStripeCheckoutLocale,
} from "./billing-runtime.ts";

describe("billing runtime config", () => {
  it("normalizes purchase surfaces with disabled as the fail-closed default", () => {
    expect(normalizePurchaseSurface("in_app_link")).toBe("in_app_link");
    expect(normalizePurchaseSurface("web_only")).toBe("web_only");
    expect(normalizePurchaseSurface("oops")).toBe("disabled");
    expect(normalizePurchaseSurface(null)).toBe("disabled");
  });

  it("fails closed when runtime config cannot be loaded", async () => {
    const config = await loadRuntimeBillingConfig({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "missing" } }),
          }),
        }),
      }),
    });
    expect(config).toEqual({
      purchaseSurface: "disabled",
      trialDealCreditAllowance: 30,
      paidDealCreditAllowance: 60,
      creditReservationTtlMinutes: 15,
    });
  });

  it("normalizes supported Stripe Checkout locales", () => {
    expect(normalizeStripeCheckoutLocale("en-US")).toBe("en");
    expect(normalizeStripeCheckoutLocale("es")).toBe("es-419");
    expect(normalizeStripeCheckoutLocale("es-419")).toBe("es-419");
    expect(normalizeStripeCheckoutLocale("ko-KR")).toBe("ko");
  });
});
