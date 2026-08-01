import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("iOS trial Checkout release gates", () => {
  it("keeps a dedicated server switch between the native source and Stripe", () => {
    const source = read("supabase/functions/stripe-create-checkout-session/index.ts");
    expect(source).toContain('type BillingSource = "admin" | "website" | "email" | "native_ios"');
    expect(source).toContain('.eq("key", "ios_trial_checkout")');
    expect(source).toContain('source === "native_ios" && !(await iosTrialCheckoutEnabled');
    expect(source).toContain('error_code: "IOS_TRIAL_CHECKOUT_DISABLED"');
  });

  it("creates the switch OFF and permits the audited native source", () => {
    const migration = read("supabase/migrations/20260824150000_ios_trial_checkout_kill_switch.sql");
    expect(migration).toContain("'ios_trial_checkout'");
    expect(migration).toMatch(/'ios_trial_checkout',[\s\S]*?false,/);
    expect(migration).toContain("'native_ios'");
  });

  it("keeps every client failure on localized approval-email and support guidance", () => {
    const hook = read("hooks/use-trial-activation.ts");
    const card = read("components/merchant-access-blocked-card.tsx");
    const create = read("app/(tabs)/create.tsx");

    expect(hook).toContain("if (result.ok && (await openWebsiteUrl(result.url))) return true");
    expect(hook).toContain("setFailed(true)");
    expect(hook).not.toMatch(/openBillingStartUrl|BILLING_START_URL|openPricingUrl/);
    expect(card).toContain('t("merchantAccess.verifyEmailHint")');
    expect(card).toContain('t("merchantAccess.checkoutUnavailable")');
    expect(card).toContain('t("merchantAccess.contactSupport")');
    expect(create).toContain("reason={billingAccess.reason}");
    expect(create).toContain('t("merchantAccess.checkoutUnavailable")');
    expect(create).toContain('t("merchantAccess.contactSupport")');

    for (const locale of ["en", "es", "ko"]) {
      const messages = JSON.parse(read(`lib/i18n/locales/${locale}.json`));
      expect(messages.merchantAccess.checkoutUnavailable).toBeTruthy();
      expect(messages.merchantAccess.verifyEmailHint).toBeTruthy();
      expect(messages.merchantAccess.contactSupport).toBeTruthy();
    }
  });
});
