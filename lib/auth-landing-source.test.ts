import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const authLandingSource = readFileSync(join(process.cwd(), "app", "auth-landing.tsx"), "utf8");

describe("auth landing source guards", () => {
  it("keeps signup auth fields compressed enough for the legal footer", () => {
    expect(authLandingSource).toContain("const authInputPadding = isSignup ? Spacing.md : Spacing.lg");
    expect(authLandingSource).toContain("const authSubmitBottomGap = isSignup ? Spacing.sm : Spacing.md");
    expect(authLandingSource).toContain("padding: authInputPadding");
    expect(authLandingSource).toContain("paddingRight: authInputPadding + 24 + Spacing.md");
    expect(authLandingSource).toContain("marginBottom: authSubmitBottomGap");
  });

  it("keeps the legal footer in a centered touch-safe row", () => {
    expect(authLandingSource).toContain('i18nKey="authLanding.legalFooter"');
    expect(authLandingSource).toContain("minHeight: 44");
    expect(authLandingSource).toContain("paddingVertical: Spacing.xs");
    expect(authLandingSource).toContain("maxFontSizeMultiplier={1.1}");
  });
});
