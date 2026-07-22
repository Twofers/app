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
  it("tells the owner which detail blocked publishing, not just that one did", () => {
    // The validation banner renders at the top of the form while Publish sits at
    // the bottom, so on a filled-in draft the owner who pressed Publish saw only
    // the generic "fix the deal details above" card with nothing naming the
    // problem. The publish path must surface the specific reason on that card.
    expect(createAiSource).toContain("function publishValidationFailure(): string | null");
    expect(createAiSource).toContain("const validationFailure = publishValidationFailure();");
    expect(createAiSource).toContain("setPublishStatusMessage(validationFailure);");
    // The generic body must no longer be what a validation failure reports.
    expect(createAiSource).not.toContain('setPublishStatusMessage(t("createAi.publishValidationBody"))');
    // Every rejection still raises the banner too, via the shared helper.
    expect(createAiSource).toContain("setBanner({ message, tone: \"error\" });");
  });

  it("localizes the cutoff-versus-duration rejection in every supported locale", () => {
    // This message was reachable only through its hardcoded English defaultValue
    // because the key existed in no locale file.
    for (const locale of ["en", "es", "ko"] as const) {
      const messages = readLocale(locale);
      expect(messages.createQuick?.errCutoffDuration ?? "").not.toBe("");
    }
  });

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

  it("keeps the poster headline live-editable through preview and publish", () => {
    // Preview and publish build the poster from the SAME live field; the stale
    // generated spec is only a fallback when no offer definition exists.
    expect(createAiSource).toContain("const [posterHeadlineText, setPosterHeadlineText] = useState(\"\");");
    expect(createAiSource).toContain(
      "const effectivePosterSpec = showPosterFormat ? livePosterPreviewSpec ?? generatedAd?.poster ?? null : null;",
    );
    const previewHeadline = "headline: posterHeadlineText.trim() || title.trim() || generatedAd?.headline || null,";
    expect(createAiSource.split(previewHeadline).length - 1).toBe(2);
    // Seeded from every generated/revised ad and restored image version.
    expect(createAiSource).toContain("setPosterHeadlineText(ad.poster?.copy?.headline ?? \"\");");
    // Visible fit limit on the input plus a publish-time block, never a silent rewrite.
    expect(createAiSource).toContain("maxLength={POSTER_TEXT_LIMITS.headline}");
    expect(createAiSource).toContain("checkMerchantPosterHeadline(posterHeadlineText)");
    expect(createAiSource).toContain("createAi.errPosterTextTooLong");
    expect(createAiSource).toContain("createAi.errPosterTextNotAllowed");
  });

  it("keeps a manual poster subheadline live-editable through preview and publish", () => {
    expect(createAiSource).toContain("const [posterSublineText, setPosterSublineText] = useState(\"\");");
    expect(createAiSource).toContain("setPosterSublineText(ad.poster?.copy?.subline ?? \"\");");
    expect(createAiSource).toContain("maxLength={POSTER_TEXT_LIMITS.subline}");
    expect(createAiSource).toContain("checkMerchantPosterSubline(posterSublineText)");
    expect(createAiSource.split("subline: posterSublineText.trim() || null,").length - 1).toBe(2);
    // One source locale on both sides of the approve/publish boundary. Pinning the
    // two old spellings separately is what let them drift apart: publish rebuilt the
    // presentation from a different locale than the merchant approved, so the exact
    // presentation hashes could never match and publishing was blocked outright.
    expect(createAiSource).toContain("sourceLocale: publishSourceLocale");
    expect(createAiSource).toContain("sourceLocale: supportedSourceLocaleForPublish");

    for (const locale of ["en", "es", "ko"] as const) {
      const createAi = readLocale(locale).createAi;
      expect(createAi.editPosterHeadline, `${locale} editPosterHeadline`).toBeTruthy();
      expect(createAi.editPosterSubheadline, `${locale} editPosterSubheadline`).toBeTruthy();
      expect(createAi.posterHeadlinePlaceholder, `${locale} posterHeadlinePlaceholder`).toBeTruthy();
      expect(createAi.posterSubheadlinePlaceholder, `${locale} posterSubheadlinePlaceholder`).toBeTruthy();
      expect(createAi.posterHeadlineNotAllowed, `${locale} posterHeadlineNotAllowed`).toBeTruthy();
      expect(createAi.posterSubheadlineNotAllowed, `${locale} posterSubheadlineNotAllowed`).toBeTruthy();
      expect(createAi.approveChangesTitle, `${locale} approveChangesTitle`).toBeTruthy();
      expect(createAi.approveChangesBody, `${locale} approveChangesBody`).toBeTruthy();
      expect(createAi.approveChangesButton, `${locale} approveChangesButton`).toBeTruthy();
      expect(createAi.errPosterTextTooLong, `${locale} errPosterTextTooLong`).toBeTruthy();
      expect(createAi.errPosterTextNotAllowed, `${locale} errPosterTextNotAllowed`).toBeTruthy();
    }
  });

  it("keeps every accepted text editor mounted while invalidating stale approvals", () => {
    const invalidationStart = createAiSource.indexOf("function invalidateAcceptedAdDraft()");
    const invalidationEnd = createAiSource.indexOf("function acceptAd()", invalidationStart);
    const invalidationSource = createAiSource.slice(invalidationStart, invalidationEnd);

    expect(invalidationSource).not.toContain("setAdAccepted(false)");
    expect(invalidationSource).toContain("setManualDraftUnlocked(true)");
    expect(invalidationSource).toContain("setApprovedComposedPresentationHash(null)");
    expect(invalidationSource).toContain("setApprovedLocalizationApprovalHash(null)");
    expect(invalidationSource).toContain('setPublishStatus("idle")');

    for (const setter of [
      "setPosterHeadlineText(value)",
      "setPosterSublineText(value)",
      "setTitle(value)",
      "setPromoLine(value)",
      "setCtaText(value)",
      "setDescription(value)",
    ]) {
      expect(createAiSource).toContain(`${setter}; invalidateAcceptedAdDraft();`);
    }
  });

  it("approves and publishes the live edited snapshot without restoring stale AI copy", () => {
    const acceptStart = createAiSource.indexOf("function acceptAd()");
    const acceptEnd = createAiSource.indexOf("function useFallbackTemplateAd()", acceptStart);
    const acceptSource = createAiSource.slice(acceptStart, acceptEnd);

    expect(createAiSource).toContain('import { buildAiDealReviewDraft } from "../../lib/ai-deal-review-draft";');
    expect(createAiSource).toContain("const reviewGeneratedAd = liveReviewDraft.ad;");
    expect(createAiSource).toContain("generatedAd: reviewGeneratedAd,");
    expect(createAiSource).toContain("ad: reviewGeneratedAd,");
    expect(acceptSource).not.toContain("applyAdToDraft(generatedAd)");
    expect(acceptSource).toContain("setManualDraftUnlocked(true)");
    expect(createAiSource).toContain("acceptedDraftRequiresReapproval");
    expect(createAiSource).toContain('t("createAi.approveChangesButton")');
    expect(createAiSource.split("reviewContext:").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("restores generated drafts into an editable, explicitly unapproved state", () => {
    // Matched by regex, not a literal: git normalizes app/create/ai.tsx to CRLF
    // on Windows checkouts, so a hardcoded "\n" in the expected string cannot
    // match. \s+ spans either line ending, like the assertion below.
    expect(createAiSource).toMatch(/manualDraftUnlocked \|\|\s+\(!generatedAd && hasDraftCopy\)/);
    expect(createAiSource).toMatch(
      /setApprovedComposedPresentationHash\(null\);\s+setApprovedLocalizationApprovalHash\(null\);\s+setManualDraftUnlocked\(draft\.manualDraftUnlocked/,
    );
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
    expect(readLocale("es").createAi.scheduleLabel).toBe("Horario:");
    expect(readLocale("es").createAi.maxClaimsLabel).toBe("Reclamos máximos:");
    expect(readLocale("ko").createAi.scheduleLabel).toBe("일정:");
    expect(readLocale("ko").createAi.maxClaimsLabel).toBe("최대 클레임:");
  });

  it("surfaces poster format while keeping poster generation fixed to the premium template", () => {
    const formatSwitchStart = createAiSource.indexOf("function selectCreativeFormat(nextFormat: CreativeFormat)");
    const formatSwitchEnd = createAiSource.indexOf("useEffect(() =>", formatSwitchStart);
    const formatSwitchSource = createAiSource.slice(formatSwitchStart, formatSwitchEnd);

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
    expect(formatSwitchSource).toContain("setAdAccepted(false);");
    expect(formatSwitchSource).not.toContain("resetGenerationState();");
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

  it("keeps generated and accepted standard previews on the consumer feed-style card", () => {
    const generatedPreviewStart = createAiSource.indexOf("{generatedAd && !adAccepted ?");
    const generatedPreviewEnd = createAiSource.indexOf("{showCopyAlternatives", generatedPreviewStart);
    const generatedPreviewSource = createAiSource.slice(generatedPreviewStart, generatedPreviewEnd);
    const acceptedPreviewStart = createAiSource.indexOf("{showDraftEditor");
    const acceptedPreviewEnd = createAiSource.indexOf("<Text style={{ marginTop: 16, color: theme.text }}>{t(\"createAi.editHeadline\")}</Text>", acceptedPreviewStart);
    const acceptedPreviewSource = createAiSource.slice(acceptedPreviewStart, acceptedPreviewEnd);

    expect(createAiSource).toContain("function StandardDealPreviewCard");
    expect(generatedPreviewSource).toContain("<StandardDealPreviewCard");
    expect(generatedPreviewSource).toContain("imageUri={adImageUri}");
    expect(generatedPreviewSource).toContain('statusLabel={t("dealStatus.live")}');
    expect(acceptedPreviewSource).toContain("<StandardDealPreviewCard");
    expect(acceptedPreviewSource).toContain("imageUri={previewUri}");
    expect(acceptedPreviewSource).toContain('noImageLabel={t("createAi.errImageGenerationNoImage")}');
    expect(createAiSource).toContain('const shouldPublishPosterSpec = creativeFormat === "poster_v1" || previewFormat === "poster_v1";');
    expect(createAiSource).toContain("posterLiveScheduleLabel");
    expect(createAiSource).toContain("liveScheduleLabel={posterLiveScheduleLabel}");
    expect(createAiSource).toContain("posterEyebrowLabel");
    expect(createAiSource).toContain("eyebrowLabel={posterEyebrowLabel}");
    expect(createAiSource).not.toContain("const renderPosterLiveStrip = () =>");
    expect(createAiSource).not.toContain("acceptedPosterCta");
    expect(createAiSource).not.toContain("consumerWallet.useDealTitle");
    expect(createAiSource).toContain("displayScheduleSummary");
    expect(generatedPreviewSource).not.toContain("termsLine={");
    expect(generatedPreviewSource).not.toContain('{t("createAi.scheduleLabel")} {displayScheduleSummary}');
    expect(generatedPreviewSource).not.toContain("renderPosterLiveStrip()");
    expect(acceptedPreviewSource).not.toContain("renderPosterLiveStrip()");
    expect(acceptedPreviewSource).not.toContain("acceptedPosterDetailLine");
    expect(acceptedPreviewSource).not.toContain("acceptedPosterAddress");
    expect(acceptedPreviewSource).not.toContain("createAi.maxClaimsLabel");
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

  it("blocks poster-format generation from continuing without an image asset", () => {
    const noImageGateCount =
      createAiSource.split("if (!imageVersionStoragePath(normalizedAd))").length - 1;

    expect(noImageGateCount).toBeGreaterThanOrEqual(2);
    expect(createAiSource).toContain("if (!imageVersionStoragePath(generatedAd))");
    expect(createAiSource).toContain("if (!hasImageSource)");
    expect(createAiSource).toContain("if (!posterForPublish)");
    expect(createAiSource).not.toContain("if (!imageVersionStoragePath(normalizedAd) && !showPosterFormat)");
    expect(createAiSource).not.toContain("if (!imageVersionStoragePath(generatedAd) && !showPosterFormat)");
    expect(createAiSource).not.toContain("if (!hasImageSource && !showPosterFormat)");
    expect(createAiSource).not.toContain("if (!posterForPublish && !showPosterFormat)");
  });

  it("keeps no-photo manual drafts out of the deterministic fallback visual", () => {
    const acceptedPreviewStart = createAiSource.indexOf("{showDraftEditor");
    const acceptedPreviewEnd = createAiSource.indexOf("<Text style={{ marginTop: 16, color: theme.text }}>{t(\"createAi.editHeadline\")}</Text>", acceptedPreviewStart);
    const acceptedPreviewSource = createAiSource.slice(acceptedPreviewStart, acceptedPreviewEnd);

    expect(createAiSource).toContain("function StandardDealPreviewCard");
    expect(createAiSource).toContain('name="image-not-supported"');
    expect(acceptedPreviewSource).toContain("<StandardDealPreviewCard");
    expect(acceptedPreviewSource).toContain('noImageLabel={t("createAi.errImageGenerationNoImage")}');
    expect(acceptedPreviewSource).not.toContain("<DraftFallbackVisual");
    expect(createAiSource).not.toContain("buildDeterministicAdFallbackVisual");
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

  it("shows one variant with an always-visible refine panel (no multi-variant picker)", () => {
    // Dan 2026-07-08: replaced the multi-variant copy picker with a single
    // variant + an always-on "Ask AI for changes" refine panel. The picker and
    // its whole apparatus (strategy chips, "N angles" count, per-option select,
    // "Offer facts locked" badge, "Why this angle" box) must stay removed.
    expect(createAiSource).not.toContain("const copyAlternativeOptions =");
    expect(createAiSource).not.toContain("const showCopyAlternatives");
    expect(createAiSource).not.toContain("function selectCopyOption");
    expect(createAiSource).not.toContain("function copyStrategyLabelKey");
    expect(createAiSource).not.toContain("function copyStrategyReasonKey");
    expect(createAiSource).not.toContain("createAi.copyOptionsCount");
    expect(createAiSource).not.toContain("createAi.copyOptionFactsLocked");
    expect(createAiSource).not.toContain("createAi.copyOptionReasonLabel");
    expect(createAiSource).not.toContain("createAi.copyOptionNumber");
    // The refine panel is no longer gated behind "Change words".
    expect(createAiSource).toContain("const showComposedRevisePanel = !adAccepted;");
    expect(createAiSource).not.toContain('composedEditIntent === "words"');
    expect(createAiSource).not.toContain("createAi.composedChangeWords");
  });

  it("routes poster-format generated review to the native poster canvas", () => {
    const generatedPreviewStart = createAiSource.indexOf("{generatedAd && !adAccepted ?");
    const generatedPreviewEnd = createAiSource.indexOf("{showCopyAlternatives", generatedPreviewStart);
    const generatedPreviewSource = createAiSource.slice(generatedPreviewStart, generatedPreviewEnd);

    expect(generatedPreviewSource).toContain("createAi.dealPreview");
    expect(createAiSource).toContain("const showPosterFormat = creativeFormat === \"poster_v1\" || previewFormat === \"poster_v1\";");
    expect(createAiSource).toContain("const effectivePosterSpec = showPosterFormat ? livePosterPreviewSpec ?? generatedAd?.poster ?? null : null;");
    expect(createAiSource).toContain("const renderPosterPreview = () =>");
    expect(createAiSource).toContain("<AdPosterCanvas");
    expect(createAiSource).toContain("spec={effectivePosterSpec}");
    expect(generatedPreviewSource).toContain("showPosterPreview ? (");
    expect(generatedPreviewSource).toContain("renderPosterPreview()");
    expect(generatedPreviewSource).toContain("<StandardDealPreviewCard");
  });

  it("keeps accepted poster preview native while retaining the standard-card fallback", () => {
    const acceptedPreviewStart = createAiSource.indexOf("{showDraftEditor");
    const acceptedPreviewEnd = createAiSource.indexOf("<Text style={{ marginTop: 16, color: theme.text }}>{t(\"createAi.editHeadline\")}</Text>", acceptedPreviewStart);
    const acceptedPreviewSource = createAiSource.slice(acceptedPreviewStart, acceptedPreviewEnd);

    expect(createAiSource).not.toContain("showDraftPosterPreview");
    expect(acceptedPreviewSource).toContain("showPosterPreview ? (");
    expect(acceptedPreviewSource).toContain("renderPosterPreview()");
    expect(acceptedPreviewSource).not.toContain("renderPosterLiveStrip()");
    expect(createAiSource).not.toContain('name="event"');
    expect(createAiSource).not.toContain("consumerWallet.useDealTitle");
    expect(acceptedPreviewSource).not.toContain('name="confirmation-number"');
    expect(acceptedPreviewSource).not.toContain("dealDetail.dealDetails");
    expect(acceptedPreviewSource).toContain("<StandardDealPreviewCard");
    expect(acceptedPreviewSource).toContain("imageVersionStoragePath(generatedAd)");
  });

  it("keeps generated research context out of the owner review UI", () => {
    const generatedPreviewStart = createAiSource.indexOf("{generatedAd && !adAccepted ?");
    const generatedPreviewEnd = createAiSource.indexOf("{showDraftEditor", generatedPreviewStart);
    const generatedReviewSource = createAiSource.slice(generatedPreviewStart, generatedPreviewEnd);

    expect(generatedReviewSource).not.toContain("createAi.researchLabel");
    expect(generatedReviewSource).not.toContain("generatedAd.item_research?.is_familiar");
  });

  it("syncs AI-generated copy into deal details immediately", () => {
    // The single generated variant is pushed into the editable deal fields as
    // soon as it comes back (no picker selection step in between).
    expect(createAiSource).toMatch(/setGeneratedAd\(normalizedAd\);\s+applyAdToDraft\(normalizedAd\);/);
  });
});
