import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "app/create/ai.tsx"), "utf8");

describe("AI create owner language preview source guards", () => {
  it("keeps shared preview data available for composed and legacy preview cards", () => {
    expect(source).toContain("buildOwnerLanguagePreview");
    expect(source).toContain("const composedOfferFacts = ownerLanguagePreview.offerFacts");
    expect(source).toContain("const composedCopy = ownerLanguagePreview.copy");
    expect(source).toMatch(/headline=\{ownerLanguagePreview\.headline\}/);
    expect(source).toMatch(/body=\{ownerLanguagePreview\.body\}/);
    expect(source).toMatch(/offerLine=\{ownerLanguagePreview\.offerLine\}/);
    expect(source).toMatch(/termsLine=\{ownerLanguagePreviewDisplayTermsLine\}/);
    expect(source).toMatch(/cta=\{ownerLanguagePreview\.cta\}/);
  });

  it("keeps merchant language preview controls disabled and absent from the screen", () => {
    expect(source).toContain("const ownerLanguagePreviewAvailable = false;");
    expect(source).not.toContain("ownerLanguagePreviewControls");
    expect(source).not.toContain("setMerchantPreviewLocale");
    expect(source).not.toContain("createAi.previewLanguageTitle");
    expect(source).not.toContain("createAi.localizedApprovalDisclosure");
    expect(source).toContain("localization: ownerLanguagePreviewAvailable ? undefined : null");
  });
});
