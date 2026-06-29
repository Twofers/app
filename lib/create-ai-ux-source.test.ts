import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const createAiSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const createHubSource = readFileSync(join(process.cwd(), "app", "(tabs)", "create.tsx"), "utf8");
const dealEligibilityFormSource = readFileSync(join(process.cwd(), "components", "deal-eligibility-form.tsx"), "utf8");
const welcomeWalkthroughSource = readFileSync(join(process.cwd(), "components", "welcome-walkthrough.tsx"), "utf8");

function readLocale(locale: "en" | "es" | "ko") {
  return JSON.parse(
    readFileSync(join(process.cwd(), "lib", "i18n", "locales", `${locale}.json`), "utf8"),
  ) as Record<string, Record<string, string>>;
}

describe("AI create UX source guards", () => {
  it("keeps generation recovery gated by failure type", () => {
    expect(createAiSource).toContain("lastGenerationOutcomeKind");
    expect(createAiSource).toContain("classifyGenerationFailure({");
    expect(createAiSource).toContain("hasFallbackSource: hasFallbackTemplateSource()");
    expect(createAiSource).toContain("canUseFallbackTemplateForOutcome(lastGenerationOutcomeKind)");
    expect(createAiSource).toContain("createAi.generationOwnershipBody");
    expect(createAiSource).toContain("createAi.generationNoFallbackBody");
    expect(createAiSource).toContain("createAi.fallbackTemplateUnavailable");
    expect(createAiSource).toContain('showManualAction: lastGenerationOutcomeKind !== "ownership_blocked"');
  });

  it("keeps publish and save controls visibly blocked until required copy exists", () => {
    expect(createAiSource).toContain("const publishReadiness = useMemo");
    expect(createAiSource).toContain("if (!title.trim()) missingFields.push(\"headline\")");
    expect(createAiSource).toContain("if (!description.trim()) missingFields.push(\"details\")");
    expect(createAiSource).toContain('displayedPublishStatus === "missing"');
    expect(createAiSource).toContain("<SecondaryButton");
    expect(createAiSource).toContain("title={publishReadiness.buttonLabel}");
    expect(createAiSource).toContain("disabled={savingTemplate || !canPublish}");
  });

  it("keeps past-template loading errors scoped to the templates area", () => {
    expect(createHubSource).toContain("templatesLoadError");
    expect(createHubSource).toContain("setTemplatesLoadError(t(\"createHub.templatesLoadError\"))");
    expect(createHubSource).toContain("onRetry={() => void loadTemplates()}");
    expect(createHubSource).not.toContain("setBanner({ message: t(\"createHub.templatesLoadError\")");
  });

  it("waits for the photo step to collapse before scrolling to AI Step 2", () => {
    expect(createAiSource).toContain("pendingDescriptionScrollAfterCollapseRef");
    expect(createAiSource).toContain("if (!photoStepCollapsed || !pendingDescriptionScrollAfterCollapseRef.current) return");
    expect(createAiSource).toContain("scrollToDescriptionStep();");
    expect(createAiSource).toContain('scrollToFormY(descriptionSectionYRef.current, "none", Spacing.xs)');
  });

  it("keeps compact offer-rule choices short enough for S10 AI Step 2", () => {
    expect(createAiSource).toContain("<DealEligibilityForm");
    expect(createAiSource).toContain("compact");
    expect(dealEligibilityFormSource).toContain('flexDirection: compact ? "row" : "column"');
    expect(dealEligibilityFormSource).toContain("minWidth: compact ? 0 : undefined");
    expect(dealEligibilityFormSource).toContain("flexBasis: compact ? 0 : undefined");
    expect(dealEligibilityFormSource).toContain("flexShrink: compact ? 1 : undefined");
    expect(dealEligibilityFormSource).toContain("!compact ? (");
    expect(dealEligibilityFormSource).toContain("activeTypeHelper");
    expect(dealEligibilityFormSource).toContain("numberOfLines={1}");
    expect(dealEligibilityFormSource).not.toContain("numberOfLines={compact ? 3 : undefined}");
  });

  it("keeps the business walkthrough scoped inside the dashboard screen", () => {
    expect(welcomeWalkthroughSource).not.toContain("Modal");
    expect(welcomeWalkthroughSource).toContain('position: "absolute"');
    expect(welcomeWalkthroughSource).toContain("zIndex: 20");
  });

  it("keeps create AI locale keys present in active locales", () => {
    const en = readLocale("en").createAi;
    for (const locale of ["es", "ko"] as const) {
      const translated = readLocale(locale).createAi;
      for (const key of Object.keys(en)) {
        expect(translated, `${locale}.createAi missing ${key}`).toHaveProperty(key);
      }
    }
  });

  it("keeps poster generation fixed to the premium template", () => {
    expect(createAiSource).toContain('const FIXED_POSTER_TEMPLATE_ID: PosterTemplateId = "premium";');
    expect(createAiSource).toContain("style: FIXED_POSTER_TEMPLATE_ID");
    expect(createAiSource).toContain("selectedPosterTemplateId: PosterTemplateId = FIXED_POSTER_TEMPLATE_ID");
    expect(createAiSource).not.toContain("EXPLICIT_POSTER_STYLE_CHOICES");
    expect(createAiSource).not.toContain("POSTER_STYLE_CHOICES");
    expect(createAiSource).not.toContain("selectPosterStyle");
    expect(createAiSource).toContain("posterTryOurLabel");
  });

  it("keeps generated preview terms from repeating separately rendered schedule metadata", () => {
    const posterPreviewStart = createAiSource.indexOf("{showPosterPreview");
    const posterPreviewEnd = createAiSource.indexOf(") : composedAdPreviewEnabled", posterPreviewStart);
    const posterPreviewSource = createAiSource.slice(posterPreviewStart, posterPreviewEnd);
    const acceptedPreviewStart = createAiSource.indexOf("{showDraftEditor");
    const acceptedPreviewEnd = createAiSource.indexOf("<Text style={{ marginTop: 16, color: theme.text }}>{t(\"createAi.editHeadline\")}</Text>", acceptedPreviewStart);
    const acceptedPreviewSource = createAiSource.slice(acceptedPreviewStart, acceptedPreviewEnd);

    expect(createAiSource).toContain("stripAppRenderedTimingMetadata");
    expect(createAiSource).toContain("ownerLanguagePreviewDisplayTermsLine");
    expect(createAiSource).toContain("termsLine={ownerLanguagePreviewDisplayTermsLine}");
    expect(createAiSource).toContain('const shouldBuildPosterSpec = (creativeFormat === "poster_v1" || previewFormat === "poster_v1");');
    expect(createAiSource).toContain('const shouldPublishPosterSpec = creativeFormat === "poster_v1" || previewFormat === "poster_v1";');
    expect(posterPreviewSource).toContain("{ownerLanguagePreviewDisplayTermsLine}");
    expect(posterPreviewSource).not.toContain("{ownerLanguagePreview.termsLine}");
    expect(posterPreviewSource).not.toContain('{t("createAi.scheduleLabel")} {displayScheduleSummary}');
    expect(acceptedPreviewSource).not.toContain('{t("createAi.scheduleLabel")} {displayScheduleSummary}');
    expect(acceptedPreviewSource).not.toContain('{t("createAi.maxClaimsLabel")} {maxClaims}');
  });
});
