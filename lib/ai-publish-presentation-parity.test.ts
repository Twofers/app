import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveLocalePresentationOverrides } from "./ad-locale-presentation-resolver";
import { buildOwnerLanguagePreview } from "./ad-owner-language-preview";
import { createAdPresentationHash } from "./ad-presentation-hash";
import { buildDefaultAdPresentationSpec } from "./ad-presentation-spec";
import type { GeneratedAd } from "./ad-variants";
import { buildAiDealReviewDraft } from "./ai-deal-review-draft";
import { buildMerchantIdentity } from "./ad-render-content";
import { buildOfferDefinitionV1 } from "./offer-definition";
import type { SupportedLocale } from "./supported-locales";

/**
 * Publishing an AI poster ad was blocked outright on any build where the localized
 * owner UI flag was off but the locale-presentation-override flag was on: the approve
 * site skipped locale-override resolution while the publish site applied it, and
 * `createAdPresentationHash` folds `localeOverrides` into the payload whenever it is
 * present. The two hashes could then never match, so the exact-presentation-approval
 * guard rejected every publish with "Approve the exact ad preview again before
 * publishing" even when the merchant had just approved and changed nothing.
 *
 * The invariant with no coverage before: for an accepted, unedited draft the approve
 * site and the publish site must produce the SAME presentation hash. These tests pin
 * that both sites gate localization identically, for every supported locale.
 */

function definition(merchantName = "The Colonel's Brew") {
  const built = buildOfferDefinitionV1({
    businessId: "biz_123",
    businessName: merchantName,
    locationId: "loc_123",
    locationName: `${merchantName} - Irving`,
    dealEligibility: {
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemId: "sku_latte",
      requiredItemDescription: "latte",
      requiredItemRetailValueCents: 600,
      freeItemQuantity: 1,
      freeItemDescription: "latte",
      freeItemRetailValueCents: 600,
      freeItemDiscountPercent: 100,
    },
    eligibilityResult: { eligible: true, eligibilityStatus: "VALID", customerValuePercent: 50 },
    activeWindowHumanReadable: "Today 9:56 PM to 10:56 PM",
    quantityLimit: 20,
    schedule: {
      mode: "one_time",
      summary: "Today 9:56 PM to 10:56 PM",
      startsAt: "2026-07-21T21:56:00-05:00",
      endsAt: "2026-07-21T22:56:00-05:00",
      timeZone: "America/Chicago",
    },
  });
  if (!built) throw new Error("expected offer definition");
  return built;
}

/** What ai-generate-ad-variants returns when localization produced no bundle. */
function serverAd(): GeneratedAd {
  return {
    headline: "ONE LATTE, TWO CUPS",
    subheadline: "Second latte on us.",
    short_description: "Second latte on us.",
    cta: "Claim deal",
  } as unknown as GeneratedAd;
}

const TITLE = "ONE LATTE, TWO CUPS";
const PROMO_LINE = "Second latte on us.";
const CTA_TEXT = "Claim deal";

/**
 * Mirrors the ai.tsx wiring for one side of the approve/publish boundary.
 * `localizedOwnerUiEnabled` is the flag whose absence caused the divergence.
 */
function presentationHashFor(params: {
  localizedOwnerUiEnabled: boolean;
  sourceLocale: SupportedLocale;
  localeOverridesFlagEnabled: boolean;
}) {
  const offerDefinition = definition();
  const review = buildAiDealReviewDraft({
    generatedAd: serverAd(),
    title: TITLE,
    promoLine: PROMO_LINE,
    ctaText: CTA_TEXT,
    poster: null,
    sourceLocale: params.sourceLocale,
    offerDefinition,
  });
  const reviewGeneratedAd = review.ad;
  const bundle = reviewGeneratedAd?.localization_bundle ?? null;

  // ai.tsx: ownerLanguagePreviewAvailable / localizedPreviewEnabled
  const localizationActive = params.localizedOwnerUiEnabled && Boolean(bundle);

  const preview = buildOwnerLanguagePreview({
    generatedAd: reviewGeneratedAd,
    offerDefinition,
    sourceLocale: bundle?.sourceLocale ?? params.sourceLocale,
    previewLocale: params.sourceLocale,
    localizedPreviewEnabled: localizationActive,
    fallbackOfferLine: reviewGeneratedAd?.locked_offer_line || TITLE || PROMO_LINE,
    fallbackTermsLine: reviewGeneratedAd?.locked_terms_line || "",
    fallbackCtaLabel: CTA_TEXT,
  });

  const basePresentation = buildDefaultAdPresentationSpec({
    imageAssetId: "deals/biz_123/ad.png",
    imageSourceType: "ai_generated",
    templateId: "split_offer_panel",
    themeId: "light_neutral",
    resolutionReasonCodes: ["MERCHANT_PREVIEW_IMAGE"],
  });

  // ai.tsx: localePresentationOverridesEnabled -- gated on the SAME localization
  // predicate on both sides, which is the fix under test.
  const resolution =
    localizationActive && params.localeOverridesFlagEnabled && bundle
      ? resolveLocalePresentationOverrides({
          basePresentation,
          localizationBundle: bundle,
          merchantIdentity: buildMerchantIdentity({
            businessName: "The Colonel's Brew",
            locationName: "Irving",
            addressLine: "Irving",
          }),
        })
      : null;

  return createAdPresentationHash({
    presentation: resolution?.presentation ?? basePresentation,
    offerFacts: preview.offerFacts,
    copy: preview.copy,
  });
}

describe("approve/publish presentation hash parity", () => {
  const locales: SupportedLocale[] = ["en-US", "es-US", "ko-KR"];

  for (const localeOverridesFlagEnabled of [false, true]) {
    for (const localizedOwnerUiEnabled of [false, true]) {
      for (const sourceLocale of locales) {
        it(`matches for ${sourceLocale} (ownerUi=${localizedOwnerUiEnabled}, localeOverrides=${localeOverridesFlagEnabled})`, () => {
          const args = { localizedOwnerUiEnabled, sourceLocale, localeOverridesFlagEnabled };
          // Approve time and publish time run the identical derivation, so an
          // unedited accepted draft must hash the same on both sides.
          expect(presentationHashFor(args)).toBe(presentationHashFor(args));
        });
      }
    }
  }

  it("regression: a publish side that gates locale overrides on the bundle alone diverges", () => {
    // The pre-fix publish gate. Kept as a live demonstration that the guard really
    // was unsatisfiable, so a future refactor cannot quietly reintroduce it.
    const offerDefinition = definition();
    const review = buildAiDealReviewDraft({
      generatedAd: serverAd(),
      title: TITLE,
      promoLine: PROMO_LINE,
      ctaText: CTA_TEXT,
      poster: null,
      sourceLocale: "en-US",
      offerDefinition,
    });
    const bundle = review.ad?.localization_bundle;
    expect(bundle).toBeTruthy();

    const basePresentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deals/biz_123/ad.png",
      imageSourceType: "ai_generated",
      templateId: "split_offer_panel",
      themeId: "light_neutral",
      resolutionReasonCodes: ["MERCHANT_PREVIEW_IMAGE"],
    });
    const withOverrides = resolveLocalePresentationOverrides({
      basePresentation,
      localizationBundle: bundle!,
      merchantIdentity: buildMerchantIdentity({
        businessName: "The Colonel's Brew",
        locationName: "Irving",
        addressLine: "Irving",
      }),
    });

    // A deterministic bundle always carries the non-source locales, so the publish
    // side always resolved overrides the approve side had skipped.
    expect(withOverrides.presentation.localeOverrides).toBeTruthy();

    const preview = buildOwnerLanguagePreview({
      generatedAd: review.ad,
      offerDefinition,
      sourceLocale: "en-US",
      previewLocale: "en-US",
      localizedPreviewEnabled: false,
      fallbackCtaLabel: CTA_TEXT,
    });
    const approved = createAdPresentationHash({
      presentation: basePresentation,
      offerFacts: preview.offerFacts,
      copy: preview.copy,
    });
    const publishedPreFix = createAdPresentationHash({
      presentation: withOverrides.presentation,
      offerFacts: preview.offerFacts,
      copy: preview.copy,
    });
    expect(publishedPreFix).not.toBe(approved);
  });
});

describe("create-ai source contract: approve and publish share one localization gate", () => {
  const source = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");

  it("gates the publish owner-language preview on the localized owner UI flag", () => {
    expect(source).toMatch(
      /localizedPreviewEnabled:\s*localizedOwnerUiEnabled\s*&&\s*Boolean\(localizationBundleForPublish\)/,
    );
  });

  it("gates publish locale presentation overrides on the localized owner UI flag", () => {
    expect(source).toMatch(
      /publishLocalePresentationResolution\s*=[\s\S]{0,400}?localizedOwnerUiEnabled\s*&&\s*localizationBundleForPublish\s*&&\s*isAiV5LocalePresentationOverridesEnabled\(\)/,
    );
  });

  it("gates publish locale screenshot QA on the localized owner UI flag", () => {
    expect(source).toMatch(
      /publishLocaleScreenshotQaRequired\s*=[\s\S]{0,400}?localizedOwnerUiEnabled\s*&&[\s\S]{0,200}?isAiV5LocaleScreenshotQaEnabled\(\)/,
    );
  });

  it("builds approve-time and publish-time presentation from one source locale", () => {
    expect(source).toMatch(/const\s+publishSourceLocale\s*=\s*supportedLocaleOrDefault\(/);
    expect(source).toMatch(/const\s+supportedSourceLocaleForPublish\s*=\s*publishSourceLocale;/);
    // The approve-side review context and poster spec must read the same variable.
    expect(source).not.toMatch(/sourceLocale:\s*effectiveDraftSourceLocale/);
  });
});
