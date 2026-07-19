import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("billing trial start ownership", () => {
  it("does not start or extend trials from the business hook", () => {
    const source = readRepoFile("hooks/use-business.ts");
    expect(source).not.toMatch(/30\s*\*\s*86400000/);
    expect(source).not.toMatch(/subscription_status:\s*["']trial["']/);
    expect(source).not.toMatch(/trial_ends_at:\s*String/);
  });

  it("does not seed trial state during business setup", () => {
    const source = readRepoFile("app/business-setup.tsx");
    expect(source).not.toMatch(/trialEndsIso/);
    expect(source).not.toMatch(/subscription_status:\s*["']trial["']/);
    expect(source).not.toMatch(/trial_ends_at/);
  });

  it("does not expose mobile billing checkout or the old no-card owner trial RPC", () => {
    const source = readRepoFile("app/(tabs)/account/billing.tsx");
    expect(source).toMatch(/Redirect/);
    expect(source).toMatch(/\/\(tabs\)\/account/);
    expect(source).not.toMatch(/start_location_trial/);
    expect(source).not.toMatch(/trial_acknowledged/);
    expect(source).not.toMatch(/stripe-expire-pending-checkout/);
    expect(source).not.toMatch(/stripe-create-checkout-session/);
    expect(source).not.toMatch(/stripe-customer-portal-session/);
    expect(source).not.toMatch(/openBrowserAsync/);
  });

  it("uses the merchant access helper for create navigation instead of starting trials", () => {
    const source = readRepoFile("hooks/use-primary-location-billing-gate.ts");
    expect(source).toMatch(/getMerchantAccessForBillingSummary/);
    expect(source).toMatch(/useLocationBillingSummary\(bypass \? null : primaryLocationId\)/);
    expect(source).toMatch(
      /loading:\s*!bypass\s*&&\s*Boolean\(businessId\)\s*&&\s*\(locationsLoading\s*\|\|\s*summaryLoading\s*\|\|\s*capabilitiesLoading\)/,
    );
  });
});
