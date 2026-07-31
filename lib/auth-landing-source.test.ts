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

describe("native social sign-in wiring", () => {
  it("renders nothing unless the kill switch and a real client ID are in place", () => {
    expect(authLandingSource).toContain("const showSocialButtons = googleSignInReady || showAppleButton;");
    expect(authLandingSource).toContain("if (!showSocialButtons) return null;");
  });

  it("offers Apple only on iOS, and only where the OS actually supports it", () => {
    expect(authLandingSource).toContain(
      'const showAppleButton = socialAuthEnabled && Platform.OS === "ios" && appleAvailable;',
    );
  });

  it("applies the signup terms gate before launching a picker", () => {
    expect(authLandingSource).toContain("if (isSignup && !termsAccepted) {");
    expect(authLandingSource).toContain("if (isSignup) await setPendingSocialRole(signupRole);");
  });

  it("treats a dismissed picker as a silent no-op", () => {
    expect(authLandingSource).toContain('if (result.status === "cancelled") {');
  });

  it("routes by the shared completion decision instead of guessing a role", () => {
    expect(authLandingSource).toContain("const decision = decideSocialCompletion({ storedRole, pendingRole });");
    expect(authLandingSource).toContain('{!signUpAwaitingVerification && !finishSetup ? (');
  });

  it("blocks an Apple private-relay address on both business paths", () => {
    // Once for a resolved/pending business role, once for the role chosen in finish-setup.
    expect(authLandingSource).toContain("if (shouldBlockBusinessRelayEmail(decision.role, user.email)) {");
    expect(authLandingSource).toContain("if (shouldBlockBusinessRelayEmail(signupRole, finishSetup.email)) {");
  });

  it("logs the new auth paths", () => {
    expect(authLandingSource).toContain('logAuthPath(provider === "google" ? "google_signin" : "apple_signin");');
    expect(authLandingSource).toContain('logAuthPath("social_finish_setup", user.email ?? undefined);');
  });
});
