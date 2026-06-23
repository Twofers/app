import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "app/create/ai.tsx"), "utf8");

describe("AI create owner language preview wiring", () => {
  it("uses the shared owner language preview result for composed and legacy preview cards", () => {
    expect(source).toContain("buildOwnerLanguagePreview");
    expect(source).toContain("const composedOfferFacts = ownerLanguagePreview.offerFacts");
    expect(source).toContain("const composedCopy = ownerLanguagePreview.copy");
    expect(source).toMatch(/headline=\{ownerLanguagePreview\.headline\}/);
    expect(source).toMatch(/body=\{ownerLanguagePreview\.body\}/);
    expect(source).toMatch(/offerLine=\{ownerLanguagePreview\.offerLine\}/);
    expect(source).toMatch(/termsLine=\{ownerLanguagePreview\.termsLine\}/);
    expect(source).toMatch(/cta=\{ownerLanguagePreview\.cta\}/);
  });

  it("shows owner preview language controls only when a localization bundle exists", () => {
    expect(source).toMatch(/ownerLanguagePreviewAvailable\s*=\s*[\s\S]*generatedAd\?\.localization_bundle/);
    expect(source).toMatch(/const ownerLanguagePreviewControls = ownerLanguagePreviewAvailable \?/);
    expect(source).toMatch(/sourceLanguage: SUPPORTED_LOCALE_METADATA\[ownerLanguagePreview\.sourceLocale\]/);
    expect(source).toMatch(/previewLanguage: SUPPORTED_LOCALE_METADATA\[ownerLanguagePreview\.locale\]/);
  });
});
