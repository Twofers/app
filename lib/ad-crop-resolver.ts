import type { AdLayoutTemplateId, AdPresentationSpec } from "./ad-presentation-spec";
import type { ImageSafeZoneResult } from "./image-safe-zone";

export type AdCropResolutionResult = {
  crop: AdPresentationSpec["crop"];
  focalPoint: AdPresentationSpec["focalPoint"];
  textZone: AdPresentationSpec["textZone"];
  repairCodes: string[];
};

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeCrop(crop: AdPresentationSpec["crop"]): AdPresentationSpec["crop"] {
  if (!crop) return undefined;
  const x = Math.min(clamp01(safeNumber(crop.x, 0)), 0.95);
  const y = Math.min(clamp01(safeNumber(crop.y, 0)), 0.95);
  return {
    x,
    y,
    width: Math.min(Math.max(0.05, clamp01(safeNumber(crop.width, 1))), 1 - x),
    height: Math.min(Math.max(0.05, clamp01(safeNumber(crop.height, 1))), 1 - y),
  };
}

export function resolveAdCrop(params: {
  presentation?: Partial<AdPresentationSpec> | null;
  imageSafeZones: ImageSafeZoneResult;
  templateId: AdLayoutTemplateId;
}): AdCropResolutionResult {
  const repairCodes: string[] = [];
  const fallback = !params.imageSafeZones.available;
  const currentCrop = normalizeCrop(params.presentation?.crop);

  if (fallback) {
    return {
      crop: undefined,
      focalPoint: undefined,
      textZone: "bottom",
      repairCodes: ["USE_DETERMINISTIC_FALLBACK"],
    };
  }

  const focalBounds = params.imageSafeZones.focalItemBounds;
  const focalPoint =
    params.presentation?.focalPoint ??
    (focalBounds
      ? {
          x: clamp01(focalBounds.x + focalBounds.width / 2),
          y: clamp01(focalBounds.y + focalBounds.height / 2),
        }
      : { x: 0.5, y: 0.5 });

  let textZone: AdPresentationSpec["textZone"] = params.presentation?.textZone ?? "bottom";
  if (params.templateId === "split_offer_panel") {
    textZone = "bottom";
  } else if (textZone === "bottom" && !params.imageSafeZones.bottomOverlaySafeZone) {
    textZone = params.imageSafeZones.topOverlaySafeZone ? "top" : params.imageSafeZones.rightSafeZone ? "right" : "bottom";
    repairCodes.push("CHANGE_TEXT_ZONE");
  } else if (textZone === "top" && !params.imageSafeZones.topOverlaySafeZone) {
    textZone = params.imageSafeZones.bottomOverlaySafeZone ? "bottom" : params.imageSafeZones.rightSafeZone ? "right" : "bottom";
    repairCodes.push("CHANGE_TEXT_ZONE");
  }

  const crop =
    currentCrop ??
    (params.imageSafeZones.confidence >= 0.72
      ? {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        }
      : undefined);
  if (!currentCrop && crop) repairCodes.push("USE_FULL_SAFE_CROP");

  return {
    crop,
    focalPoint,
    textZone,
    repairCodes: [...new Set(repairCodes)],
  };
}
