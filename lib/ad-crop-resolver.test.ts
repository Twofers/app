import { describe, expect, it } from "vitest";

import { resolveAdCrop } from "./ad-crop-resolver";
import type { ImageSafeZoneResult } from "./image-safe-zone";

const safeZones: ImageSafeZoneResult = {
  available: true,
  confidence: 0.84,
  focalItemBounds: { x: 0.25, y: 0.3, width: 0.4, height: 0.4 },
  cropSafeCenter: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
  topOverlaySafeZone: { x: 0.06, y: 0.04, width: 0.88, height: 0.22 },
  bottomOverlaySafeZone: { x: 0.06, y: 0.66, width: 0.88, height: 0.3 },
  leftSafeZone: { x: 0.04, y: 0.18, width: 0.35, height: 0.64 },
  rightSafeZone: { x: 0.61, y: 0.18, width: 0.35, height: 0.64 },
  logoSafeZone: { x: 0.05, y: 0.05, width: 0.22, height: 0.16 },
  forbiddenProductOverlapRegion: { x: 0.25, y: 0.3, width: 0.4, height: 0.4 },
  reasonCodes: [],
};

describe("ad crop resolver", () => {
  it("uses the image focal bounds when no crop is provided", () => {
    const result = resolveAdCrop({
      imageSafeZones: safeZones,
      templateId: "hero_image_overlay",
    });

    expect(result.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(result.focalPoint).toEqual({ x: 0.45, y: 0.5 });
    expect(result.repairCodes).toContain("USE_FULL_SAFE_CROP");
  });

  it("moves overlay text when the requested zone is not safe", () => {
    const result = resolveAdCrop({
      imageSafeZones: {
        ...safeZones,
        bottomOverlaySafeZone: null,
      },
      presentation: { textZone: "bottom" },
      templateId: "hero_image_overlay",
    });

    expect(result.textZone).toBe("top");
    expect(result.repairCodes).toContain("CHANGE_TEXT_ZONE");
  });

  it("fails closed to the deterministic fallback path without a usable image", () => {
    const result = resolveAdCrop({
      imageSafeZones: {
        ...safeZones,
        available: false,
        confidence: 0,
      },
      presentation: {
        crop: { x: 1.5, y: 1.5, width: 0.4, height: 0.4 },
      },
      templateId: "hero_image_overlay",
    });

    expect(result.crop).toBeUndefined();
    expect(result.focalPoint).toBeUndefined();
    expect(result.textZone).toBe("bottom");
    expect(result.repairCodes).toEqual(["USE_DETERMINISTIC_FALLBACK"]);
  });
});
