import { describe, expect, it } from "vitest";

import {
  createAdPresentationHash,
  type AdPresentationReviewContext,
} from "./ad-presentation-hash";
import { buildDefaultAdPresentationSpec } from "./ad-presentation-spec";
import type { ApprovedAdCopy, ImmutableOfferFacts } from "./ad-render-content";

const offerFacts: ImmutableOfferFacts = {
  primaryOfferLine: "Buy one latte and get one free",
  compactOfferLine: "Buy one latte and get one free",
  termsLine: "Limit one claim per customer.",
  accessibilityOfferDescription: "Buy one latte and get one free. Limit one claim per customer.",
};

const copy: ApprovedAdCopy = {
  headline: "Your coffee break just doubled",
  supportingCopy: "Bring a friend before the window closes.",
  ctaLabel: "Claim deal",
};

const reviewContext: AdPresentationReviewContext = {
  creativeFormat: "poster_v1",
  sourceLocale: "en-US",
  headline: copy.headline,
  supportingCopy: copy.supportingCopy ?? "",
  ctaLabel: copy.ctaLabel,
  details: "Available this afternoon.",
  poster: {
    templateId: "premium",
    headline: "COFFEE BREAK UPGRADE",
    subline: "BAKED FRESH DAILY",
    offerLine1: "BUY 1 LATTE",
    offerLine2: "GET 1 COOKIE FREE",
  },
};

describe("ad presentation hash", () => {
  it("is stable for the approved creative and presentation inputs", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
    });

    expect(createAdPresentationHash({ presentation, offerFacts, copy })).toBe(
      createAdPresentationHash({ presentation: { ...presentation }, offerFacts: { ...offerFacts }, copy: { ...copy } }),
    );
  });

  it("changes when material presentation inputs change", () => {
    const base = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
    });
    const changed = { ...base, templateId: "split_offer_panel" as const };

    expect(createAdPresentationHash({ presentation: base, offerFacts, copy })).not.toBe(
      createAdPresentationHash({ presentation: changed, offerFacts, copy }),
    );
  });

  it("changes when locale presentation overrides change", () => {
    const base = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
    });
    const withLocaleOverride = buildDefaultAdPresentationSpec({
      ...base,
      localeOverrides: {
        "es-US": {
          templateId: "split_offer_panel",
          textPanel: "solid_bottom",
          showSupportingCopy: false,
          resolutionReasonCodes: ["LONG_SPANISH_COPY_SAFE_SPLIT"],
        },
      },
    });

    expect(createAdPresentationHash({ presentation: base, offerFacts, copy })).not.toBe(
      createAdPresentationHash({ presentation: withLocaleOverride, offerFacts, copy }),
    );
  });

  it("does not include live countdown or quantity state", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
    });
    const withSchedule = { ...offerFacts, scheduleSummary: "Ends in 12 minutes", priceLabel: "$4.00" };
    const withoutSchedule = { ...offerFacts, scheduleSummary: "Ends in 1 minute", priceLabel: "$4.00" };

    expect(createAdPresentationHash({ presentation, offerFacts: withSchedule, copy })).toBe(
      createAdPresentationHash({ presentation, offerFacts: withoutSchedule, copy }),
    );
  });

  it("keeps legacy hashes unchanged when no review context is supplied", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
    });

    expect(createAdPresentationHash({ presentation, offerFacts, copy })).toBe(
      createAdPresentationHash({ presentation, offerFacts, copy, reviewContext: undefined }),
    );
  });

  it.each([
    ["creative format", { creativeFormat: "standard_card" }],
    ["source locale", { sourceLocale: "es-US" }],
    ["headline", { headline: "A different headline" }],
    ["supporting copy", { supportingCopy: "Different supporting copy" }],
    ["CTA", { ctaLabel: "Use deal" }],
    ["details", { details: "Different deal details" }],
  ] as const)("changes when the live %s changes", (_label, change) => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
    });
    const changedContext = { ...reviewContext, ...change } as AdPresentationReviewContext;

    expect(createAdPresentationHash({ presentation, offerFacts, copy, reviewContext })).not.toBe(
      createAdPresentationHash({ presentation, offerFacts, copy, reviewContext: changedContext }),
    );
  });

  it.each([
    ["template", { templateId: "bold" }],
    ["headline", { headline: "A DIFFERENT POSTER" }],
    ["subline", { subline: "A NEW SUBLINE" }],
    ["offer line one", { offerLine1: "BUY 2 LATTES" }],
    ["offer line two", { offerLine2: "GET 2 COOKIES FREE" }],
  ] as const)("changes when the poster %s changes", (_label, posterChange) => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
    });
    const changedContext: AdPresentationReviewContext = {
      ...reviewContext,
      poster: { ...reviewContext.poster!, ...posterChange } as AdPresentationReviewContext["poster"],
    };

    expect(createAdPresentationHash({ presentation, offerFacts, copy, reviewContext })).not.toBe(
      createAdPresentationHash({ presentation, offerFacts, copy, reviewContext: changedContext }),
    );
  });
});
