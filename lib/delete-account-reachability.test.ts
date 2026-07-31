import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveTabModeRedirectTarget } from "./tab-mode-redirect";

const businessSetupSource = readFileSync(join(process.cwd(), "app", "business-setup.tsx"), "utf8");
const accountSource = readFileSync(join(process.cwd(), "app", "(tabs)", "account", "index.tsx"), "utf8");
const deleteFlowSource = readFileSync(join(process.cwd(), "hooks", "use-delete-account-flow.ts"), "utf8");

function readLocale(locale: "en" | "es" | "ko") {
  return JSON.parse(
    readFileSync(join(process.cwd(), "lib", "i18n", "locales", `${locale}.json`), "utf8"),
  ) as Record<string, Record<string, string>>;
}

describe("in-app account deletion stays reachable for business accounts", () => {
  // Why this suite exists: the published privacy policy promises deletion "inside
  // the app under Account or Settings" and Apple guideline 5.1.1(v) requires an
  // in-app path. Device QA on 2026-07-25 found a business account with no
  // approved application had none — the test user had to be removed from the
  // Supabase dashboard.

  it("still redirects every business tab, including account, while the profile is incomplete", () => {
    // This is the trap the fix works around, so pin it: `account` is a business
    // tab, so an incomplete profile bounces it to /business-setup like the rest.
    // If this ever stops being true the setup-screen path is no longer the only
    // surface and this suite should be revisited rather than silently passing.
    for (const tab of ["create", "redeem", "dashboard", "account"]) {
      expect(
        resolveTabModeRedirectTarget({
          mode: "business",
          tab,
          currentPath: `/(tabs)/${tab}`,
          forceBypass: false,
          checkingProfile: false,
          businessProfileComplete: false,
        }),
      ).toBe("/business-setup");
    }
  });

  it("gives the pending-approval setup screen a delete-account action", () => {
    expect(businessSetupSource).toContain("useDeleteAccountFlow");
    expect(businessSetupSource).toContain("onPress={startDeleteAccount}");
    expect(businessSetupSource).toContain('t("deleteAccount.cta")');
    // The branded modal must be mounted inside the early-returned pending tree,
    // otherwise the confirmations never render on this screen.
    expect(businessSetupSource).toMatch(/<\/ScrollView>\s+\{confirmModal\}/);
  });

  it("treats a merchant account as possibly owning business data", () => {
    // finalBusinessBody is the conditional wording ("If you created a business…"),
    // correct whether or not the application was ever approved. The shopper
    // variant would understate what deletion removes.
    expect(businessSetupSource).toContain("includesBusinessData: true");
  });

  it("drives both surfaces from one flow rather than a second copy", () => {
    // A duplicated destructive flow is how the two screens drift apart. Account
    // must consume the same hook, and must not keep a private implementation.
    expect(accountSource).toContain("useDeleteAccountFlow");
    expect(accountSource).toContain("onPress={startDeleteAccount}");
    expect(accountSource).not.toContain("async function runDeleteAccount");
  });

  it("signs out locally and returns to the auth landing after deletion", () => {
    expect(deleteFlowSource).toContain("await deleteUserAccount();");
    expect(deleteFlowSource).toContain('await supabase.auth.signOut({ scope: "local" });');
    expect(deleteFlowSource).toContain("await clearLocalAuthSessionState();");
    expect(deleteFlowSource).toContain('router.replace("/auth-landing" as Href)');
  });

  it("never shows a raw server error during deletion", () => {
    expect(deleteFlowSource).toContain("translateKnownApiMessage");
    expect(deleteFlowSource).toContain("DELETE_ACCOUNT_URL");
  });

  it("localizes every string the delete path renders", () => {
    const locales = { en: readLocale("en"), es: readLocale("es"), ko: readLocale("ko") };
    const keys = [
      "cta",
      "title",
      "body",
      "reviewImpactCta",
      "finalTitle",
      "finalBusinessBody",
      "finalConfirmDestructive",
      "keepAccount",
      "errFailed",
      "fallbackWebBody",
      "openWebsiteFallbackCta",
      "alertDismiss",
    ];
    for (const [name, bundle] of Object.entries(locales)) {
      for (const key of keys) {
        expect(bundle.deleteAccount?.[key], `deleteAccount.${key} missing from ${name}`).toBeTruthy();
      }
    }
  });
});
