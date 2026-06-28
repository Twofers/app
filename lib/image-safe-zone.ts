import type { AdImageSourceType } from "./ad-presentation-spec";
import type { SourceAwareImageQaResult } from "./quick-deal-image-qa";

export type ImageSafeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageSafeZoneResult = {
  available: boolean;
  confidence: number;
  focalItemBounds: ImageSafeRect | null;
  cropSafeCenter: ImageSafeRect;
  topOverlaySafeZone: ImageSafeRect | null;
  bottomOverlaySafeZone: ImageSafeRect | null;
  leftSafeZone: ImageSafeRect | null;
  rightSafeZone: ImageSafeRect | null;
  logoSafeZone: ImageSafeRect | null;
  forbiddenProductOverlapRegion: ImageSafeRect | null;
  reasonCodes: string[];
};

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function rect(rect: ImageSafeRect): ImageSafeRect {
  const x = Math.min(clamp01(rect.x, 0), 0.99);
  const y = Math.min(clamp01(rect.y, 0), 0.99);
  return {
    x,
    y,
    width: Math.min(Math.max(0.01, clamp01(rect.width, 1)), 1 - x),
    height: Math.min(Math.max(0.01, clamp01(rect.height, 1)), 1 - y),
  };
}

function hasCropRisk(imageQa: SourceAwareImageQaResult | null | undefined): boolean {
  if (!imageQa) return false;
  return [...imageQa.warningCodes, ...imageQa.hardFailReasons].some((code) => /CROP_OR_OVERLAY/i.test(code));
}

function hasForbiddenRisk(imageQa: SourceAwareImageQaResult | null | undefined): boolean {
  if (!imageQa) return false;
  return imageQa.hardFailReasons.some((code) => /READABLE_TEXT|LOGO|QR|FORBIDDEN/i.test(code));
}

function hasMissingItemRisk(imageQa: SourceAwareImageQaResult | null | undefined): boolean {
  if (!imageQa) return false;
  return imageQa.missingItems.length > 0 || imageQa.hardFailReasons.some((code) => /MISSING_REQUIRED_ITEM/i.test(code));
}

export function buildImageSafeZoneResult(params: {
  hasImage: boolean;
  imageSourceType: AdImageSourceType;
  imageQa?: SourceAwareImageQaResult | null;
  cropSuitabilityScore?: number | null;
  focalPoint?: { x: number; y: number } | null;
}): ImageSafeZoneResult {
  const reasonCodes: string[] = [];
  const fallback = params.imageSourceType === "deterministic_fallback";
  const qa = params.imageQa ?? null;
  const hasImage = params.hasImage && !fallback && qa?.available !== false;
  const cropRisk = hasCropRisk(qa);
  const forbiddenRisk = hasForbiddenRisk(qa);
  const missingItemRisk = hasMissingItemRisk(qa);
  const cropSuitability = clamp01(params.cropSuitabilityScore ?? 0.78, 0.78);
  let confidence = fallback ? 1 : hasImage ? cropSuitability : 0;

  if (!hasImage && !fallback) reasonCodes.push("NO_IMAGE_ASSET");
  if (cropRisk) {
    confidence = Math.min(confidence, 0.42);
    reasonCodes.push("CROP_OR_OVERLAY_RISK");
  }
  if (forbiddenRisk) {
    confidence = Math.min(confidence, 0.28);
    reasonCodes.push("FORBIDDEN_VISUAL_ELEMENT_RISK");
  }
  if (missingItemRisk) {
    confidence = Math.min(confidence, 0.36);
    reasonCodes.push("REQUIRED_ITEM_VISIBILITY_RISK");
  }
  if (qa?.decision === "block") {
    confidence = Math.min(confidence, 0.18);
    reasonCodes.push("IMAGE_QA_BLOCKED");
  }
  if (qa?.decision === "warn") reasonCodes.push("IMAGE_QA_WARNING");
  if (fallback) reasonCodes.push("DETERMINISTIC_FALLBACK_SAFE");

  const focalX = clamp01(params.focalPoint?.x ?? 0.5, 0.5);
  const focalY = clamp01(params.focalPoint?.y ?? 0.5, 0.5);
  const focalItemBounds = fallback
    ? null
    : rect({
        x: focalX - 0.24,
        y: focalY - 0.24,
        width: 0.48,
        height: 0.48,
      });

  const overlaySafe = confidence >= 0.65 && !cropRisk && !forbiddenRisk;

  return {
    available: fallback || (hasImage && qa?.decision !== "block"),
    confidence,
    focalItemBounds,
    cropSafeCenter: rect({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 }),
    topOverlaySafeZone: overlaySafe ? rect({ x: 0.06, y: 0.04, width: 0.88, height: 0.22 }) : null,
    bottomOverlaySafeZone: overlaySafe ? rect({ x: 0.06, y: 0.66, width: 0.88, height: 0.3 }) : null,
    leftSafeZone: confidence >= 0.52 ? rect({ x: 0.04, y: 0.18, width: 0.35, height: 0.64 }) : null,
    rightSafeZone: confidence >= 0.52 ? rect({ x: 0.61, y: 0.18, width: 0.35, height: 0.64 }) : null,
    logoSafeZone: overlaySafe ? rect({ x: 0.05, y: 0.05, width: 0.22, height: 0.16 }) : null,
    forbiddenProductOverlapRegion: focalItemBounds,
    reasonCodes: [...new Set(reasonCodes)],
  };
}
