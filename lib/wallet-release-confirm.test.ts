import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const walletSource = readFileSync(join(process.cwd(), "app", "(tabs)", "wallet.tsx"), "utf8");

function readLocale(locale: "en" | "es" | "ko") {
  return JSON.parse(
    readFileSync(join(process.cwd(), "lib", "i18n", "locales", `${locale}.json`), "utf8"),
  ) as Record<string, Record<string, string>>;
}

describe("releasing a wallet claim asks first", () => {
  it("routes the release button through a confirmation, not straight to the forfeit", () => {
    // F-09: a single tap used to give the claim up. That is not always
    // reversible — a sold-out deal, or one that has hit its daily cap, cannot
    // be re-claimed.
    expect(walletSource).toContain("onPress={() => confirmReleaseWalletClaim(row)}");
    expect(walletSource).not.toContain("onPress={() => void releaseWalletClaim(row)}");
  });

  it("uses the branded confirm rather than Alert.alert", () => {
    expect(walletSource).toContain("useBrandedConfirm");
    expect(walletSource).toContain("{confirmModal}");
    expect(walletSource).not.toContain("Alert.alert");
  });

  it("keeps the in-flight and status guards on the confirmed path", () => {
    // The guards must survive on the new entry point, otherwise confirming
    // twice, or confirming an already-ended claim, reaches the network call.
    expect(walletSource).toMatch(
      /function confirmReleaseWalletClaim\(row: ClaimRow\) \{\s+if \(row\.claim_status !== "active" && row\.claim_status !== "redeeming"\) return;\s+if \(releasingClaimId\) return;/,
    );
  });

  it("localizes the confirmation copy in en, es and ko", () => {
    const keys = ["releaseConfirmTitle", "releaseConfirmBody", "releaseConfirmCta", "releaseKeepCta"];
    for (const locale of ["en", "es", "ko"] as const) {
      const bundle = readLocale(locale);
      for (const key of keys) {
        expect(bundle.consumerWallet?.[key], `consumerWallet.${key} missing from ${locale}`).toBeTruthy();
      }
    }
  });

  it("warns that the claim may not be recoverable", () => {
    // The whole point of the dialog: a plain "are you sure?" would not tell the
    // shopper the forfeit can be permanent.
    const en = readLocale("en");
    expect(en.consumerWallet.releaseConfirmBody).toMatch(/sells out|daily limit/i);
  });
});
