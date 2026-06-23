import { describe, expect, it } from "vitest";

import {
  MERCHANT_LOCALIZATION_PROFILE_VERSION,
  buildDefaultMerchantLocalizationProfile,
  isMerchantLocalizationProfile,
} from "./merchant-localization-profile";

describe("merchant localization profile", () => {
  it("creates the plan-required defaults for every merchant", () => {
    const profile = buildDefaultMerchantLocalizationProfile({
      businessId: "biz_123",
      preferredAuthoringLocale: "es",
      defaultDoNotTranslateTerms: ["Cedar Bean", "Cedar Bean"],
      updatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(profile).toMatchObject({
      businessId: "biz_123",
      preferredAuthoringLocale: "es-US",
      enabledConsumerLocales: ["en-US", "es-US", "ko-KR"],
      translationReviewMode: "automatic_verified",
      preserveBusinessName: true,
      defaultDoNotTranslateTerms: ["Cedar Bean"],
      profileVersion: MERCHANT_LOCALIZATION_PROFILE_VERSION,
    });
    expect(isMerchantLocalizationProfile(profile)).toBe(true);
  });
});
