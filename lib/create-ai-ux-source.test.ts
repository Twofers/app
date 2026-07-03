import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const createAiSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const createHubSource = readFileSync(join(process.cwd(), "app", "(tabs)", "create.tsx"), "utf8");
const redeemSource = readFileSync(join(process.cwd(), "app", "(tabs)", "redeem.tsx"), "utf8");
const dashboardSource = readFileSync(join(process.cwd(), "app", "(tabs)", "dashboard.tsx"), "utf8");
const accountSource = readFileSync(join(process.cwd(), "app", "(tabs)", "account", "index.tsx"), "utf8");
const aiInsightsSource = readFileSync(join(process.cwd(), "components", "ai-insights-card.tsx"), "utf8");
const redemptionModeSettingsSource = readFileSync(join(process.cwd(), "components", "redemption-mode-settings.tsx"), "utf8");
const themePreferenceSelectorSource = readFileSync(join(process.cwd(), "components", "theme-preference-selector.tsx"), "utf8");
const profileCompletenessBarSource = readFileSync(join(process.cwd(), "components", "profile-completeness-bar.tsx"), "utf8");
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

  it("keeps the business create hub compact and row-based", () => {
    expect(createHubSource).toContain("function renderHubAction");
    expect(createHubSource).toContain("minHeight: 88");
    expect(createHubSource).toContain('iconName: "add-circle-outline"');
    expect(createHubSource).toContain('iconName: "restaurant-menu"');
    expect(createHubSource).toContain('iconName: "history"');
    expect(createHubSource).toContain("function renderCompactAction");
    expect(createHubSource).not.toContain("createHub.moreToolsTitle");
    expect(createHubSource).not.toContain('<CardShell variant="muted">');
    expect(createHubSource).not.toContain('backgroundColor: theme.primary,\n              alignItems: "center"');
  });

  it("keeps redeem mode selection from duplicating the manual-code fallback", () => {
    expect(redeemSource).toContain('accessibilityRole="tab"');
    expect(redeemSource).toContain('"qr-code-scanner"');
    expect(redeemSource).toContain('"dialpad"');
    expect(redeemSource).not.toContain("redeem.manualFallbackCta");
    expect(redeemSource).not.toContain("redeem-camera-manual-fallback");
  });

  it("keeps the business offers snapshot dense enough for phone viewports", () => {
    expect(dashboardSource).toContain('flexBasis: "31%"');
    expect(dashboardSource).toContain("minHeight: 76");
    expect(dashboardSource).toContain('defaultValue: "No live deals"');
    expect(dashboardSource).not.toContain("offersDashboard.snapshotEyebrow");
    expect(dashboardSource).not.toContain("offersDashboard.dashboardDataNote");
  });

  it("keeps deeper offers dashboard sections compact on phones", () => {
    expect(dashboardSource).toContain('flexBasis: "22%"');
    expect(dashboardSource).toContain("maxFontSizeMultiplier={1.08}");
    expect(dashboardSource).toContain('minWidth: 92');
    expect(dashboardSource).not.toContain("offersDashboard.dataCoverageTitle");
    expect(dashboardSource).not.toContain("offersDashboard.dataCoverageBody");
    expect(aiInsightsSource).toContain("numberOfLines={3}");
    expect(aiInsightsSource).toContain("fontSize: 12");
  });

  it("keeps the business account summary cards compact", () => {
    expect(accountSource).toContain("numberOfLines={1}");
    expect(accountSource).toContain("numberOfLines={2}");
    expect(accountSource).toContain("minimumFontScale={0.72}");
    expect(accountSource).toContain("supportEmail");
    expect(accountSource).toContain('fontSize: 13, lineHeight: 17');
  });

  it("keeps lower business account settings compact on phones", () => {
    expect(accountSource).toContain("helper && selected");
    expect(accountSource).toContain("defaultValue: \"Claim again after X days\"");
    expect(accountSource).toContain("defaultValue: \"Claim once ever\"");
    expect(accountSource).toContain("style={{ minHeight: 44, paddingVertical: 8 }}");
    expect(accountSource).toContain("numberOfLines={3} maxFontSizeMultiplier={1.08}");
    expect(accountSource).not.toContain("Customers can claim again after X days");
    expect(accountSource).not.toContain("Customers can claim only once ever from my business");
    expect(redemptionModeSettingsSource).toContain("defaultValue: \"Staff-only redemption device.\"");
    expect(redemptionModeSettingsSource).toContain("borderRadius: Radii.md");
    expect(themePreferenceSelectorSource).toContain("minWidth: 88");
    expect(profileCompletenessBarSource).toContain("height: 6");
  });

  it("keeps active account locales compact and translated", () => {
    const en = readLocale("en");
    const es = readLocale("es");
    const ko = readLocale("ko");

    expect(en.account.repeatPolicyCooldown).toBe("Claim again after X days");
    expect(es.account.expandBizProfile).toBe("Editar campos");
    expect(es.account.advancedOptions).toBe("Más opciones");
    expect(ko.account.expandBizProfile).toBe("전체 항목 편집");
    expect(ko.account.advancedOptions).toBe("추가 옵션");
    for (const locale of [en, es, ko]) {
      expect(locale.account.repeatPolicyCooldown).not.toContain("Customers can claim again");
      expect(locale.account.repeatPolicyForever).not.toContain("Customers can claim only once");
      expect(locale.account.expandBizProfile).not.toContain("Show all business fields");
      expect(locale.account.advancedOptions).not.toBe("Advanced");
      expect(locale.deleteAccount.body.length).toBeLessThan(120);
    }
  });

  it("waits for the photo step to collapse before scrolling to AI Step 2", () => {
    expect(createAiSource).toContain("pendingDescriptionScrollAfterCollapseRef");
    expect(createAiSource).toContain("if (!photoStepCollapsed || !pendingDescriptionScrollAfterCollapseRef.current) return");
    expect(createAiSource).toContain("scrollToDescriptionStep();");
    expect(createAiSource).toContain('scrollToFormY(descriptionSectionYRef.current, "none", top + Spacing.lg)');
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
    expect(dealEligibilityFormSource).toContain('flexDirection: compact ? "column" : "row"');
    expect(dealEligibilityFormSource).toContain('width: compact ? "100%" : undefined');
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

  it("surfaces poster format while keeping poster generation fixed to the premium template", () => {
    expect(createAiSource).toContain('const FIXED_POSTER_TEMPLATE_ID: PosterTemplateId = "premium";');
    expect(createAiSource).toContain('const DEFAULT_CREATIVE_FORMAT: CreativeFormat = "poster_v1";');
    expect(createAiSource).toContain("useState<CreativeFormat>(DEFAULT_CREATIVE_FORMAT)");
    expect(createAiSource).toContain("useState<PreviewFormat>(DEFAULT_CREATIVE_FORMAT)");
    expect(createAiSource).toContain("style: FIXED_POSTER_TEMPLATE_ID");
    expect(createAiSource).toContain("selectedPosterTemplateId: PosterTemplateId = FIXED_POSTER_TEMPLATE_ID");
    expect(createAiSource).toContain("function selectCreativeFormat(nextFormat: CreativeFormat)");
    expect(createAiSource).toContain('(["standard_card", "poster_v1"] as CreativeFormat[])');
    expect(createAiSource).toContain("setCreativeFormat(nextFormat)");
    expect(createAiSource).toContain("setPreviewFormat(nextFormat)");
    expect(createAiSource).toContain("createAi.adFormatPoster");
    expect(createAiSource).toContain("createAi.adFormatStandard");
    expect(createAiSource).toContain("minHeight: 48");
    expect(createAiSource).not.toContain("createAi.adFormatPosterHelp");
    expect(createAiSource).not.toContain("createAi.adFormatStandardHelp");
    expect(createAiSource).not.toContain("createAi.posterPreviewTitle");
    expect(createAiSource).not.toContain("createAi.posterPreviewBadge");
    expect(createAiSource).not.toContain("EXPLICIT_POSTER_STYLE_CHOICES");
    expect(createAiSource).not.toContain("POSTER_STYLE_CHOICES");
    expect(createAiSource).not.toContain("posterTryOurLabel");
  });

  it("keeps generated and accepted deal previews from repeating separately rendered schedule metadata", () => {
    const generatedPreviewStart = createAiSource.indexOf("{generatedAd && !adAccepted ?");
    const generatedPreviewEnd = createAiSource.indexOf("{showCopyAlternatives", generatedPreviewStart);
    const generatedPreviewSource = createAiSource.slice(generatedPreviewStart, generatedPreviewEnd);
    const acceptedPreviewStart = createAiSource.indexOf("{showDraftEditor");
    const acceptedPreviewEnd = createAiSource.indexOf("<Text style={{ marginTop: 16, color: theme.text }}>{t(\"createAi.editHeadline\")}</Text>", acceptedPreviewStart);
    const acceptedPreviewSource = createAiSource.slice(acceptedPreviewStart, acceptedPreviewEnd);

    expect(createAiSource).toContain("stripAppRenderedTimingMetadata");
    expect(createAiSource).toContain("ownerLanguagePreviewDisplayTermsLine");
    expect(createAiSource).toContain("termsLine={ownerLanguagePreviewDisplayTermsLine}");
    expect(createAiSource).toContain('const shouldPublishPosterSpec = creativeFormat === "poster_v1" || previewFormat === "poster_v1";');
    expect(generatedPreviewSource).toContain("termsLine={ownerLanguagePreviewDisplayTermsLine}");
    expect(generatedPreviewSource).not.toContain("{ownerLanguagePreview.termsLine}");
    expect(generatedPreviewSource).not.toContain('{t("createAi.scheduleLabel")} {displayScheduleSummary}');
    expect(acceptedPreviewSource).not.toContain('{t("createAi.scheduleLabel")} {displayScheduleSummary}');
    expect(acceptedPreviewSource).not.toContain('{t("createAi.maxClaimsLabel")} {maxClaims}');
  });

  it("clears original-photo selection when AI returns a generated fallback instead", () => {
    expect(createAiSource).toContain('sentSourceMode === "merchant_original" && normalizedAd.photo_source !== "uploaded_original"');
    expect(createAiSource).toContain("setUsePhotoAsFinal(false);");
  });

  it("keeps skipped-photo generation on the real image path before fallback", () => {
    expect(createAiSource).toContain('if (!photoPath) return "ai_generated";');
    expect(createAiSource).toContain("image_source_mode: sentSourceMode");
    expect(createAiSource).toContain("createAi.fallbackVisualLabel");
    expect(createAiSource).toContain('defaultValue: "Local deal"');
    expect(createAiSource).toContain("createAi.generatingHintNoPhoto");
    expect(createAiSource).toContain("paddingBottom: scrollBottom + Spacing.xxxl * 2");
    expect(createAiSource).toContain("createAi.errImageGenerationNoImage");
    expect(createAiSource).toContain('error_code: "NO_IMAGE_RETURNED"');
    expect(createAiSource).toContain("if (!imageVersionStoragePath(normalizedAd))");
    expect(createAiSource).toMatch(
      /selectedPhotoUri\s*\?\s*t\("createAi\.generatingHint"\)\s*:\s*t\("createAi\.generatingHintNoPhoto"/,
    );
    expect(createAiSource).not.toContain("setBanner({ message: t(\"createAi.successBatchFirst\")");
    expect(createAiSource).not.toContain("createAi.photoSkipHint");
    expect(createAiSource).not.toContain("createAi.photoHint");
    expect(createAiSource).not.toContain('{t("createAi.takePhoto")} / {t("createAi.pickPhoto")}');
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

  it("routes poster-format generated review to the native poster canvas", () => {
    const generatedPreviewStart = createAiSource.indexOf("{generatedAd && !adAccepted ?");
    const generatedPreviewEnd = createAiSource.indexOf("{showCopyAlternatives", generatedPreviewStart);
    const generatedPreviewSource = createAiSource.slice(generatedPreviewStart, generatedPreviewEnd);

    expect(generatedPreviewSource).toContain("createAi.dealPreview");
    expect(createAiSource).toContain("const showPosterFormat = creativeFormat === \"poster_v1\" || previewFormat === \"poster_v1\";");
    expect(createAiSource).toContain("const effectivePosterSpec = showPosterFormat ? generatedAd?.poster ?? fallbackPosterPreviewSpec : null;");
    expect(createAiSource).toContain("const renderPosterPreview = () =>");
    expect(createAiSource).toContain("<AdPosterCanvas");
    expect(createAiSource).toContain("spec={effectivePosterSpec}");
    expect(generatedPreviewSource).toContain("showPosterPreview ? (");
    expect(generatedPreviewSource).toContain("renderPosterPreview()");
    expect(generatedPreviewSource).toContain("<GeneratedAdPreviewCard");
  });

  it("keeps accepted poster preview native while retaining the standard-card fallback", () => {
    const acceptedPreviewStart = createAiSource.indexOf("{showDraftEditor");
    const acceptedPreviewEnd = createAiSource.indexOf("<Text style={{ marginTop: 16, color: theme.text }}>{t(\"createAi.editHeadline\")}</Text>", acceptedPreviewStart);
    const acceptedPreviewSource = createAiSource.slice(acceptedPreviewStart, acceptedPreviewEnd);

    expect(createAiSource).not.toContain("showDraftPosterPreview");
    expect(acceptedPreviewSource).toContain("showPosterPreview ? (");
    expect(acceptedPreviewSource).toContain("renderPosterPreview()");
    expect(acceptedPreviewSource).toContain("dealDetail.dealDetails");
    expect(acceptedPreviewSource).toContain("<DraftFallbackVisual");
    expect(acceptedPreviewSource).toContain("imageVersionStoragePath(generatedAd)");
  });

  it("keeps generated research context out of the owner review UI", () => {
    const generatedPreviewStart = createAiSource.indexOf("{generatedAd && !adAccepted ?");
    const generatedPreviewEnd = createAiSource.indexOf("{showDraftEditor", generatedPreviewStart);
    const generatedReviewSource = createAiSource.slice(generatedPreviewStart, generatedPreviewEnd);

    expect(generatedReviewSource).not.toContain("createAi.researchLabel");
    expect(generatedReviewSource).not.toContain("generatedAd.item_research?.is_familiar");
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
