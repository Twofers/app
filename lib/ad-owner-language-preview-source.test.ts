import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "app/create/ai.tsx"), "utf8");

describe("AI create owner language preview source guards", () => {
  it("keeps shared preview data available for composed and standard preview cards", () => {
    expect(source).toContain("buildOwnerLanguagePreview");
    expect(source).toContain("const composedOfferFacts = ownerLanguagePreview.offerFacts");
    expect(source).toContain("const composedCopy = ownerLanguagePreview.copy");
    expect(source).toContain("<StandardDealPreviewCard");
    expect(source).toMatch(/headline=\{ownerLanguagePreview\.headline\}/);
    expect(source).toMatch(/body=\{ownerLanguagePreview\.body\}/);
    expect(source).toMatch(/statusLabel=\{t\("dealStatus\.live"\)\}/);
  });

  it("gates merchant language preview data on localized owner UI and a generated bundle", () => {
    expect(source).toContain("const ownerLanguagePreviewAvailable = Boolean(");
    expect(source).toContain("localizedOwnerUiEnabled &&");
    expect(source).toContain("generatedAd?.localization_bundle");
    expect(source).not.toContain("ownerLanguagePreviewControls");
    expect(source).not.toContain("setMerchantPreviewLocale");
    expect(source).not.toContain("createAi.previewLanguageTitle");
    expect(source).not.toContain("createAi.localizedApprovalDisclosure");
    expect(source).toContain("const shouldBindComposedPresentationApproval =");
    expect(source).toContain("automaticLocalizationApprovalEnabled && ownerLanguagePreviewAvailable");
  });

  it("keeps manual final-photo publishes compatible with exact localization approval", () => {
    expect(source).toContain("buildDeterministicAdLocalizationBundle");
    expect(source).toContain("manualDraftGeneratedAdForPublishSpec");
    expect(source).toContain("const deterministicLocalizationBundle =");
    expect(source).toContain("const publishLocalizationApproval =");
    expect(source).toContain("localizationApproval: localizationApprovalForPublish");
    expect(source).toContain("...(localizationBundleForPublish ? {} : { localization: null })");
  });
});
