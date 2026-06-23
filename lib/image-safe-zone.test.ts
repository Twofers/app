import { describe, expect, it } from "vitest";

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

describe("image safe zones", () => {
  it("provides overlay-safe geometry for a clean image", () => {
    const result = buildImageSafeZoneResult({
      hasImage: true,
      imageSourceType: "merchant_original",
      imageQa: passQa,
      cropSuitabilityScore: 0.82,
      focalPoint: { x: 0.45, y: 0.52 },
    });

    expect(result.available).toBe(true);
    expect(result.confidence).toBe(0.82);
    expect(result.bottomOverlaySafeZone).not.toBeNull();
    expect(result.focalItemBounds?.x).toBeCloseTo(0.21);
    expect(result.focalItemBounds?.y).toBeCloseTo(0.28);
  });

  it("lowers confidence when QA reports crop risk", () => {
    const result = buildImageSafeZoneResult({
      hasImage: true,
      imageSourceType: "ai_generated",
      imageQa: {
        ...passQa,
        sourceType: "ai_generated",
        decision: "block",
        hardFailReasons: ["CROP_OR_OVERLAY_RISK:ITEM_CUT_OFF"],
      },
    });

    expect(result.available).toBe(false);
    expect(result.confidence).toBeLessThan(0.3);
    expect(result.bottomOverlaySafeZone).toBeNull();
    expect(result.reasonCodes).toContain("IMAGE_QA_BLOCKED");
  });

  it("treats deterministic fallback as safe without image geometry", () => {
    const result = buildImageSafeZoneResult({
      hasImage: false,
      imageSourceType: "deterministic_fallback",
    });

    expect(result.available).toBe(true);
    expect(result.confidence).toBe(1);
    expect(result.focalItemBounds).toBeNull();
    expect(result.reasonCodes).toContain("DETERMINISTIC_FALLBACK_SAFE");
  });
});
