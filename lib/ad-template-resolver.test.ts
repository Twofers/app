import { describe, expect, it } from "vitest";

import { resolveAdPresentation, type TemplateResolutionInput } from "./ad-template-resolver";
import { buildImageSafeZoneResult } from "./image-safe-zone";
import type { SourceAwareImageQaResult } from "./quick-deal-image-qa";

const passQa: SourceAwareImageQaResult = {
  checked: true,
  available: true,
  sourceType: "merchant_original",
  decision: "pass",
  hardFailReasons: [],
  warningCodes: [],
  missingItems: [],
  forbiddenElements: [],
  merchantOverrideAllowed: false,
  merchantOverrideAcknowledged: false,
  notes: "",
};

function input(overrides: Partial<TemplateResolutionInput> = {}): TemplateResolutionInput {
  const imageQa = overrides.imageQa ?? passQa;
  return {
    approvedCopy: {
      headline: "Lunch tastes better together",
      supportingCopy: "Fresh sandwiches and soups from the block.",
      ctaLabel: "Claim deal",
    },
    lockedOfferContent: {
      primaryOfferLine: "Buy one lunch combo, get one lunch combo free",
      compactOfferLine: "Lunch combo BOGO",
      termsLine: "Equal or lesser value.",
      accessibilityOfferDescription: "Buy one lunch combo, get one lunch combo free. Equal or lesser value.",
    },
    merchantIdentity: {
      name: "Cedar House Cafe",
      logoVerified: false,
    },
    imageQa,
    imageSafeZones:
      overrides.imageSafeZones ??
      buildImageSafeZoneResult({
        hasImage: true,
        imageSourceType: "merchant_original",
        imageQa,
        cropSuitabilityScore: 0.84,
      }),
    creativeStrategy: "local neighborhood lunch",
    liveStateCapabilities: {
      supportsQuantityRemaining: true,
      supportsTimeRemaining: true,
    },
    targetSurface: "merchant_preview",
    imageAssetId: "deal-photos/lunch.png",
    imageSourceType: "merchant_original",
    themeId: "light_neutral",
    ...overrides,
  };
}

describe("ad template resolver", () => {
  it("recommends a live card and provides deterministic alternates for a clean live image", () => {
    const result = resolveAdPresentation(input());

    expect(result.recommended.templateId).toBe("live_drop_card");
    expect(result.recommended.imageSourceType).toBe("merchant_original");
    expect(result.alternates.map((spec) => spec.templateId)).toContain("hero_image_overlay");
    expect(result.recommended.resolutionReasonCodes).toContain("USE_FULL_SAFE_CROP");
  });

  it("keeps strategy-specific templates as instant alternates", () => {
    const result = resolveAdPresentation(
      input({
        creativeStrategy: "social moment for friends after work",
        liveStateCapabilities: {
          supportsQuantityRemaining: false,
          supportsTimeRemaining: false,
        },
      }),
    );

    expect(result.recommended.templateId).toBe("hero_image_overlay");
    expect(result.alternates.map((spec) => spec.templateId)).toContain("social_moment_card");
  });

  it("fails closed to split panel when image QA blocks the asset", () => {
    const blockedQa: SourceAwareImageQaResult = {
      ...passQa,
      decision: "block",
      hardFailReasons: ["CROP_OR_OVERLAY_RISK:ITEM_CUT_OFF"],
    };
    const result = resolveAdPresentation(
      input({
        imageQa: blockedQa,
        imageSafeZones: buildImageSafeZoneResult({
          hasImage: true,
          imageSourceType: "merchant_original",
          imageQa: blockedQa,
        }),
      }),
    );

    expect(result.recommended.templateId).toBe("split_offer_panel");
    expect(result.alternates).toEqual([]);
    expect(result.reasonCodes).toContain("IMAGE_QA_BLOCKED");
  });

  it("uses split panel for deterministic fallback without reopening image selection", () => {
    const fallbackQa: SourceAwareImageQaResult = {
      ...passQa,
      sourceType: "deterministic_fallback",
    };
    const result = resolveAdPresentation(
      input({
        imageQa: fallbackQa,
        imageSafeZones: buildImageSafeZoneResult({
          hasImage: false,
          imageSourceType: "deterministic_fallback",
          imageQa: fallbackQa,
        }),
        imageAssetId: "deterministic-fallback",
        imageSourceType: "deterministic_fallback",
      }),
    );

    expect(result.recommended.templateId).toBe("split_offer_panel");
    expect(result.reasonCodes).toContain("NO_USABLE_IMAGE");
    expect(result.reasonCodes).toContain("DETERMINISTIC_FALLBACK_SAFE");
  });
});
