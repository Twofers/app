import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "app/create/ai.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("AI create localization approval binding source", () => {
  it("records and enforces the exact localization approval hash when automatic bundle approval is enabled", () => {
    expect(source).toContain("isAiV5AutomaticVerifiedBundleApprovalEnabled");
    expect(source).toContain("isAiV5LocaleScreenshotQaEnabled");
    expect(source).toContain("resolveLocalePresentationOverrides");
    expect(source).toContain("buildVerifiedAdLocalizationApproval");
    expect(source).toContain("selectedLocaleScreenshotQaTriggerLocales");
    expect(source).toMatch(/locale_screenshot_qa_trigger_locales/);
    expect(source).toContain("approvedLocalizationApprovalHash");
    expect(source).toMatch(/reason: "localization_approval_blocked"/);
    expect(source).toMatch(/reason: "localization_approval_required"/);
    expect(source).toContain("const localizationApprovalForPublish =");
    expect(source).toContain("selectedLocalizationApproval?.approved");
    expect(source).toContain("publishLocalizationApproval?.approved");
    expect(source).toContain("localizationApproval: localizationApprovalForPublish");
  });

  it("builds publish approval metadata whenever a localization bundle is present", () => {
    expect(source).toContain("const publishLocalizationApproval =\n        offerDefinition && localizationBundleForPublish");
    expect(source).toContain("ownerLanguagePreviewAvailable &&\n    offerDefinition &&\n    generatedAd?.localization_bundle");
    expect(source).toContain("const deterministicLocalizationBundle =\n        offerDefinition &&\n        baseAdForPublishSpec &&\n        !baseAdForPublishSpec.localization_bundle");
    expect(source).not.toContain("const deterministicLocalizationBundle =\n        automaticLocalizationApprovalEnabled &&\n        offerDefinition");
  });
});
