import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "app/create/ai.tsx"), "utf8");

describe("AI create localization approval binding source", () => {
  it("records and enforces the exact localization approval hash when automatic bundle approval is enabled", () => {
    expect(source).toContain("isAiV5AutomaticVerifiedBundleApprovalEnabled");
    expect(source).toContain("buildVerifiedAdLocalizationApproval");
    expect(source).toContain("approvedLocalizationApprovalHash");
    expect(source).toMatch(/reason: "localization_approval_blocked"/);
    expect(source).toMatch(/reason: "localization_approval_required"/);
    expect(source).toMatch(/localizationApproval:\s*[\s\S]*selectedLocalizationApproval\.approval/);
  });
});
