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
    expect(createAiSource).not.toContain("posterTryOurLabel");
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

  it("clears original-photo selection when AI returns a generated fallback instead", () => {
    expect(createAiSource).toContain('sentSourceMode === "merchant_original" && normalizedAd.photo_source !== "uploaded_original"');
    expect(createAiSource).toContain("setUsePhotoAsFinal(false);");
  });

  it("keeps skipped-photo generation on the fast native-rendered fallback path", () => {
    expect(createAiSource).toContain('if (!photoPath) return "deterministic_fallback";');
    expect(createAiSource).toContain("image_source_mode: sentSourceMode");
    expect(createAiSource).toContain("createAi.fallbackVisualLabel");
    expect(createAiSource).toContain('defaultValue: "Local deal"');
    expect(createAiSource).toContain("createAi.generatingHintNoPhoto");
    expect(createAiSource).toMatch(
      /selectedPhotoUri\s*\?\s*t\("createAi\.generatingHint"\)\s*:\s*t\("createAi\.generatingHintNoPhoto"/,
    );
    expect(createAiSource).not.toContain("Twofer fallback");
  });

  it("keeps no-photo deal preview visually branded instead of blank", () => {
    const acceptedPreviewStart = createAiSource.indexOf("{showDraftEditor");
    const acceptedPreviewEnd = createAiSource.indexOf("<Text style={{ marginTop: 16, color: theme.text }}>{t(\"createAi.editHeadline\")}</Text>", acceptedPreviewStart);
    const acceptedPreviewSource = createAiSource.slice(acceptedPreviewStart, acceptedPreviewEnd);

    expect(createAiSource).toContain("function DraftFallbackVisual");
    expect(createAiSource).toContain("buildDeterministicAdFallbackVisual");
    expect(acceptedPreviewSource).toContain("<DraftFallbackVisual");
    expect(acceptedPreviewSource).not.toContain("height: 200, backgroundColor: theme.surfaceMuted");
  });

  it("keeps merchant revision comments as a first-class AI input", () => {
    expect(createAiSource).toContain("type RevisionSuggestion");
    expect(createAiSource).toContain("revisionSuggestionOptions");
    expect(createAiSource).toContain("copyOnlyRevisionTargetForFeedback");
    expect(createAiSource).toContain("from \"../../lib/ai-revision-target\"");
    expect(createAiSource).toContain("summarizeAiRevisionChange");
    expect(createAiSource).toContain("error_code: \"REVISION_UNCHANGED\"");
    expect(createAiSource).toContain("const effectiveRevisionTarget = copyOnlyRevisionTargetForFeedback(revisionTarget, revisionFeedbackText)");
    expect(createAiSource).toContain("selected_revision_target: revisionTarget");
    expect(createAiSource).toContain("revision_target: effectiveRevisionTarget");
    expect(createAiSource).toContain("reviseSuggestionTopHeadlineFeedback");
    expect(createAiSource).toContain("applyRevisionSuggestion");
    expect(createAiSource).toContain("setRevisionTarget(suggestion.target)");
    expect(createAiSource).toContain("setRevisionFeedback(suggestion.feedback)");
    expect(createAiSource).toContain("AiAdsEvents.REVISION_SUGGESTION_SELECTED");
    expect(createAiSource).toContain("AiAdsEvents.REVISION_TAPPED");
    expect(createAiSource).toContain("AiAdsEvents.REVISION_SUCCEEDED");
    expect(createAiSource).toContain("AiAdsEvents.REVISION_FAILED");
    expect(createAiSource).toContain("feedback_length: revisionFeedbackText.length");
    expect(createAiSource).toContain("const revisionSuccessKey = revisionChange.copyChanged && revisionChange.imageChanged");
    expect(createAiSource).toContain("createAi.reviseSuccessCopy");
    expect(createAiSource).toContain("progressRevisionTarget");
    expect(createAiSource).toContain("revisionProgressMessageKey");
    expect(createAiSource).toContain("revisionProgressHintKey");
    expect(createAiSource).toContain("createAi.revisingCopyHint");
    expect(createAiSource).toContain("visible={generating || revising}");
    expect(createAiSource).toContain('setBanner({ message: t(revisionSuccessKey), tone: "success" });');
    expect(createAiSource).not.toContain("revision_feedback: revisionFeedbackText,\n        feedback");
  });

  it("keeps copy-only revisions on the existing no-photo fallback path", () => {
    const revisionModeStart = createAiSource.indexOf("const revisesImage = effectiveRevisionTarget");
    const revisionCallStart = createAiSource.indexOf("const { ad, quota: nextQuota } = await aiReviseAd", revisionModeStart);
    const revisionSource = createAiSource.slice(revisionModeStart, revisionCallStart);

    expect(revisionModeStart).toBeGreaterThan(-1);
    expect(revisionCallStart).toBeGreaterThan(revisionModeStart);
    expect(revisionSource).toContain("const revisesImage = effectiveRevisionTarget === \"image\" || effectiveRevisionTarget === \"both\";");
    expect(revisionSource).toContain("imageSourceModeForPhotoChoice(photoPath, usePhotoAsFinal)");
    expect(revisionSource).toMatch(
      /revisesImage && previousSourceMode === "deterministic_fallback"\s+\?\s+"ai_generated"\s+:\s+previousSourceMode;/,
    );
    expect(createAiSource).toContain("image_source_mode: sourceModeForRevision");
  });

  it("surfaces all five AI copy lanes for merchant review", () => {
    const optionsStart = createAiSource.indexOf("const copyAlternativeOptions =");
    const optionsEnd = createAiSource.indexOf("const showCopyAlternatives", optionsStart);
    const optionsBlock = createAiSource.slice(optionsStart, optionsEnd);

    expect(optionsStart).toBeGreaterThan(-1);
    expect(optionsEnd).toBeGreaterThan(optionsStart);
    expect(optionsBlock).toContain(".slice(0, 5)");
    expect(optionsBlock).not.toContain(".slice(0, 3)");
    expect(createAiSource).toContain("function copyStrategyLabelKey");
    expect(createAiSource).toContain("createAi.copyStrategyValueClarity");
    expect(createAiSource).toContain("createAi.copyStrategySocialOccasion");
    expect(createAiSource).toContain("createAi.copyStrategyProductDesire");
    expect(createAiSource).toContain("createAi.copyStrategyLocalDiscovery");
    expect(createAiSource).toContain("createAi.copyStrategyMerchantSpecific");
    expect(createAiSource).toContain("function copyStrategyReasonKey");
    expect(createAiSource).toContain("compactReviewText(option.strategy_reason)");
    expect(createAiSource).toContain("createAi.copyOptionsCount");
    expect(createAiSource).toContain("createAi.copyOptionFactsLocked");
    expect(createAiSource).toContain("createAi.copyOptionReasonLabel");
    expect(createAiSource).toContain("createAi.copyOptionCtaLabel");
  });

  it("renders poster previews in a polished review frame", () => {
    const posterPreviewStart = createAiSource.indexOf("{showPosterPreview");
    const posterPreviewEnd = createAiSource.indexOf(") : composedAdPreviewEnabled", posterPreviewStart);
    const posterPreviewSource = createAiSource.slice(posterPreviewStart, posterPreviewEnd);

    expect(posterPreviewSource).toContain("createAi.posterPreviewTitle");
    expect(posterPreviewSource).toContain("createAi.posterPreviewBadge");
    expect(posterPreviewSource).toContain("overflow: \"hidden\"");
    expect(posterPreviewSource).toContain("backgroundColor: colorScheme === \"dark\" ? theme.surfaceElevated : Gray[900]");
    expect(posterPreviewSource).toContain("borderColor: \"rgba(255,255,255,0.16)\"");
  });

  it("tracks selected copy alternatives by candidate identity", () => {
    const selectStart = createAiSource.indexOf("function selectCopyOption");
    const selectEnd = createAiSource.indexOf("setGeneratedAd(next);", selectStart);
    const selectBlock = createAiSource.slice(selectStart, selectEnd);

    expect(createAiSource).toContain("function copyOptionsRepresentSameCandidate");
    expect(selectStart).toBeGreaterThan(-1);
    expect(selectEnd).toBeGreaterThan(selectStart);
    expect(selectBlock).toContain("selectedCopyAlternativeIndex");
    expect(selectBlock).toContain("copyOptionsRepresentSameCandidate(candidate, option)");
    expect(selectBlock).not.toContain("candidateIndex === index");
  });

  it("syncs AI-generated copy into deal details immediately", () => {
    expect(createAiSource).toMatch(/setGeneratedAd\(normalizedAd\);\s+applyAdToDraft\(normalizedAd\);/);
    expect(createAiSource).toMatch(/setGeneratedAd\(next\);\s+applyAdToDraft\(next\);/);
    expect(createAiSource).not.toContain("setGeneratedAd(next);\n    setAdAccepted(false);");
  });
});
