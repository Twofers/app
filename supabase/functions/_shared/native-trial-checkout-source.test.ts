import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("native trial Checkout release gates", () => {
  it("keeps a dedicated server switch between the native sources and Stripe", () => {
    const source = read("supabase/functions/stripe-create-checkout-session/index.ts");
    expect(source).toContain(
      'type BillingSource = "admin" | "website" | "email" | "native_ios" | "native_android"',
    );
    expect(source).toContain('.eq("key", "ios_trial_checkout")');
    expect(source).toContain("isNativeSource(source) && !(await nativeTrialCheckoutEnabled");
    expect(source).toContain('error_code: "NATIVE_TRIAL_CHECKOUT_DISABLED"');
    // Neither native source may fall through to "website" and skip the switch.
    expect(source).toMatch(/isNativeSource\(requestedSource\)\s*\n?\s*\?\s*requestedSource/);
  });

  it("creates the switch OFF and permits both audited native sources", () => {
    const killSwitch = read("supabase/migrations/20260824150000_ios_trial_checkout_kill_switch.sql");
    expect(killSwitch).toContain("'ios_trial_checkout'");
    expect(killSwitch).toMatch(/'ios_trial_checkout',[\s\S]*?false,/);
    expect(killSwitch).toContain("'native_ios'");

    const capability = read("supabase/migrations/20260825120000_native_trial_checkout_capability.sql");
    expect(capability).toContain("'native_android'");
    expect(capability).toContain("'native_ios'");
    // The capability migration must never rewrite the flag row: an ON CONFLICT
    // touch would re-trip the enabled=false reset hazard from 20260817120000.
    expect(capability).not.toMatch(/INSERT\s+INTO\s+public\.feature_flags/i);
    expect(capability).not.toMatch(/UPDATE\s+public\.feature_flags/i);
  });

  it("drives button visibility from the server capability, not a baked client flag", () => {
    const capability = read("supabase/migrations/20260825120000_native_trial_checkout_capability.sql");
    // Only an approved-but-unactivated business, and only while the switch is on.
    expect(capability).toContain(
      "'can_activate_trial_checkout', v_setup_access AND v_trial_checkout_enabled",
    );

    const hook = read("hooks/use-trial-activation.ts");
    expect(hook).toContain("canActivateTrialCheckout && nativeCheckoutSource() !== null");
    expect(hook).not.toContain("process.env");

    const parser = read("lib/business-capabilities.ts");
    expect(parser).toContain('"can_activate_trial_checkout"');

    // Every card call site must pass the capability through; a missing prop
    // defaults to false, so a silent drop hides the button rather than faking it.
    for (const screen of ["app/(tabs)/dashboard.tsx", "app/(tabs)/create.tsx", "app/(tabs)/account/index.tsx"]) {
      expect(read(screen)).toMatch(/canActivateTrialCheckout=\{[^}]*canActivateTrialCheckout\}|useTrialActivation\(businessId, [^)]*canActivateTrialCheckout\)/);
    }
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

  it("never promises a Checkout path the copy cannot guarantee", () => {
    // The 1.0.2 defect: shared strings advertised "On eligible iPhone builds,
    // secure Checkout may also be available" on Android, and on no build was it
    // true. Copy must describe the state, never the capability.
    for (const locale of ["en", "es", "ko"]) {
      const messages = JSON.parse(read(`lib/i18n/locales/${locale}.json`));
      for (const value of [messages.merchantAccess.verifyBody, messages.createHub.setupApprovedBody]) {
        expect(value).toBeTruthy();
        expect(value).not.toMatch(/iPhone|iOS|Android/i);
      }
    }
  });
});
