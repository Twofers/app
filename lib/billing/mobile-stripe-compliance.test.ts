import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("mobile Stripe billing compliance", () => {
  const mobileBillingRoutes = [
    "app/(tabs)/account/billing.tsx",
    "app/(tabs)/account/billing/manage.tsx",
    "app/(tabs)/billing.tsx",
    "app/(tabs)/billing/manage.tsx",
  ];

  it("keeps all mobile billing routes as account redirects", () => {
    for (const route of mobileBillingRoutes) {
      const source = readRepoFile(route);
      expect(source).toMatch(/Redirect/);
      expect(source).toMatch(/\/\(tabs\)\/account/);
      expect(source).not.toMatch(/stripe-create-checkout-session/);
      expect(source).not.toMatch(/stripe-customer-portal-session/);
      expect(source).not.toMatch(/openBrowserAsync/);
      expect(source).not.toMatch(/Checkout|Subscribe|Upgrade|Customer Portal|Stripe/);
    }
  });

  it("keeps mobile paid billing flags fail-closed", () => {
    const source = readRepoFile("lib/billing/access.ts");
    for (const name of [
      "isMobileStripeEnabled",
      "isMobileSubscriptionCtaEnabled",
      "isBusinessSelfServeMobileEnabled",
      "isMobilePricingPageEnabled",
      "isMobileBillingLinksEnabled",
      "isMobilePaidBillingEnabled",
    ]) {
      expect(source).toMatch(new RegExp(`function ${name}\\(\\): boolean \\{\\s*return false;\\s*\\}`));
    }
  });
});
