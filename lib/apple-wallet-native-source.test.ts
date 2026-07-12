import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const buttonSource = readFileSync("components/add-to-wallet-button.tsx", "utf8");
const moduleSource = readFileSync("modules/twofer-passkit/ios/TwoferPassKitModule.swift", "utf8");
const viewSource = readFileSync("modules/twofer-passkit/ios/TwoferPassKitButtonView.swift", "utf8");
const moduleConfig = readFileSync("modules/twofer-passkit/expo-module.config.json", "utf8");

describe("native Apple Wallet integration", () => {
  it("uses Apple's system pass button and add-pass controller", () => {
    expect(viewSource).toContain("PKAddPassButton(addPassButtonStyle: .black)");
    expect(moduleSource).toContain("PKAddPassesViewController(pass: pass)");
    expect(moduleSource).toContain("PKAddPassesViewController.canAddPasses()");
  });

  it("removes the share-sheet and custom-button fallback from the iOS path", () => {
    expect(buttonSource).toContain("AppleWalletPassButton");
    expect(buttonSource).toContain("presentAppleWalletPass");
    expect(buttonSource).not.toContain("Sharing.shareAsync");
    expect(buttonSource).not.toContain("Do NOT ship to the App Store");
  });

  it("registers the local module for Apple autolinking", () => {
    expect(JSON.parse(moduleConfig)).toEqual({
      platforms: ["apple"],
      apple: { modules: ["TwoferPassKitModule"] },
    });
  });
});
