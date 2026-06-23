import { describe, expect, it } from "vitest";

import { runDeterministicAdCompositeQa, shouldRunCompositeScreenshotQa } from "./ad-composite-qa";
import { buildDefaultAdPresentationSpec } from "./ad-presentation-spec";

const offerFacts = {
  primaryOfferLine: "Buy one latte and get one free",
  compactOfferLine: "Latte: buy one and get one free",
  termsLine: "Limit one claim per customer.",
  accessibilityOfferDescription: "Buy one latte and get one free. Limit one claim per customer.",
};

const copy = {
  headline: "Coffee tastes better together",
  supportingCopy: "Fresh espresso drinks for an afternoon break.",
  ctaLabel: "Claim deal",
};

const merchant = {
  name: "Cedar Bean",
  locationName: "Main Street",
};

const liveState = {
  status: "live" as const,
  statusLabel: "Live now",
  quantityRemainingLabel: "12 left",
  timeRemainingLabel: "Ends soon",
  claimAvailable: true,
};

describe("deterministic ad composite QA", () => {
  it("passes a complete composed card with a matching image asset", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
    });

    const result = runDeterministicAdCompositeQa({
      offerFacts,
      copy,
      merchant,
      presentation,
      liveState,
      surface: "merchant_preview",
      imageUri: "https://example.com/latte.png",
      selectedImageAssetId: "deal-photos/latte.png",
      imageSafeZoneConfidence: 0.84,
    });

    expect(result.decision).toBe("pass");
    expect(result.hardFailReasons).toEqual([]);
    expect(shouldRunCompositeScreenshotQa(result)).toBe(false);
  });

  it("repairs a risky overlay template instead of approving it silently", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/busy.png",
      imageSourceType: "ai_generated",
      templateId: "hero_image_overlay",
    });

    const result = runDeterministicAdCompositeQa({
      offerFacts,
      copy,
      merchant,
      presentation,
      liveState,
      surface: "merchant_preview",
      imageUri: "https://example.com/busy.png",
      selectedImageAssetId: "deal-photos/busy.png",
      imageSafeZoneConfidence: 0.42,
    });

    expect(result.decision).toBe("repair");
    expect(result.repairCodes).toContain("SWITCH_TO_SPLIT");
    expect(result.screenshotQaTriggerCodes).toContain("LOW_SAFE_ZONE_CONFIDENCE");
    expect(shouldRunCompositeScreenshotQa(result)).toBe(true);
  });

  it("blocks publish when the presentation points at a different image asset", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/old.png",
      imageSourceType: "merchant_original",
      templateId: "split_offer_panel",
    });

    const result = runDeterministicAdCompositeQa({
      offerFacts,
      copy,
      merchant,
      presentation,
      liveState,
      surface: "merchant_preview",
      imageUri: "https://example.com/new.png",
      selectedImageAssetId: "deal-photos/new.png",
    });

    expect(result.decision).toBe("block");
    expect(result.hardFailReasons).toContain("SELECTED_IMAGE_ASSET_MISMATCH");
  });

  it("blocks missing critical offer text", () => {
    const result = runDeterministicAdCompositeQa({
      offerFacts: { ...offerFacts, primaryOfferLine: "" },
      copy,
      merchant,
      presentation: buildDefaultAdPresentationSpec({}),
      liveState,
      surface: "merchant_preview",
    });

    expect(result.decision).toBe("block");
    expect(result.hardFailReasons).toContain("MISSING_LOCKED_OFFER_LINE");
  });
});
