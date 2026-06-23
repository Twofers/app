export type AdLayoutTemplateId =
  | "hero_image_overlay"
  | "split_offer_panel"
  | "live_drop_card"
  | "social_moment_card"
  | "local_discovery_card"
  | "signature_item_card";

export type AdTextPanel = "bottom_gradient" | "solid_bottom" | "solid_side" | "glass_bottom";

export type AdImageSourceType =
  | "merchant_original"
  | "merchant_ai_edit"
  | "ai_generated"
  | "approved_stock"
  | "deterministic_fallback";

export type AdPresentationSpec = {
  specVersion: string;
  templateId: AdLayoutTemplateId;
  themeId: string;
  imageAssetId: string;
  imageSourceType: AdImageSourceType;
  focalPoint?: {
    x: number;
    y: number;
  };
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  textPanel: AdTextPanel;
  textZone: "top" | "bottom" | "left" | "right";
  showLogo: boolean;
  showSupportingCopy: boolean;
  showLiveStatus: boolean;
  showQuantityRemaining: boolean;
  showTimeRemaining: boolean;
  resolutionReasonCodes: string[];
  rendererVersion: string;
};

export type AdPresentationValidationResult = {
  valid: boolean;
  reasonCodes: string[];
};

export const AD_PRESENTATION_SPEC_VERSION = "twofer-ad-presentation-v1";
export const AD_COMPOSED_CARD_RENDERER_VERSION = "twofer-composed-card-renderer-v1";

export const AD_PRESENTATION_TEMPLATE_IDS: readonly AdLayoutTemplateId[] = [
  "hero_image_overlay",
  "split_offer_panel",
  "live_drop_card",
  "social_moment_card",
  "local_discovery_card",
  "signature_item_card",
] as const;

export const AD_PRESENTATION_TEXT_PANELS: readonly AdTextPanel[] = [
  "bottom_gradient",
  "solid_bottom",
  "solid_side",
  "glass_bottom",
] as const;

export const AD_PRESENTATION_IMAGE_SOURCE_TYPES: readonly AdImageSourceType[] = [
  "merchant_original",
  "merchant_ai_edit",
  "ai_generated",
  "approved_stock",
  "deterministic_fallback",
] as const;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function bounded01(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeCrop(crop: AdPresentationSpec["crop"]): AdPresentationSpec["crop"] {
  if (!crop) return undefined;
  const x = bounded01(crop.x, 0);
  const y = bounded01(crop.y, 0);
  const width = bounded01(crop.width, 1);
  const height = bounded01(crop.height, 1);
  return {
    x,
    y,
    width: Math.max(0.05, Math.min(width, 1 - x)),
    height: Math.max(0.05, Math.min(height, 1 - y)),
  };
}

export function buildDefaultAdPresentationSpec(params: {
  imageAssetId?: string | null;
  imageSourceType?: AdImageSourceType | null;
  templateId?: AdLayoutTemplateId | null;
  themeId?: string | null;
  focalPoint?: AdPresentationSpec["focalPoint"];
  crop?: AdPresentationSpec["crop"];
  textPanel?: AdTextPanel | null;
  textZone?: AdPresentationSpec["textZone"] | null;
  showLogo?: boolean;
  showSupportingCopy?: boolean;
  showLiveStatus?: boolean;
  showQuantityRemaining?: boolean;
  showTimeRemaining?: boolean;
  resolutionReasonCodes?: string[];
}): AdPresentationSpec {
  const imageAssetId = cleanText(params.imageAssetId) || "deterministic-fallback";
  const imageSourceType = params.imageSourceType ?? (imageAssetId === "deterministic-fallback" ? "deterministic_fallback" : "merchant_original");
  const templateId =
    params.templateId ??
    (imageSourceType === "deterministic_fallback" ? "split_offer_panel" : "hero_image_overlay");
  const textPanel =
    params.textPanel ??
    (templateId === "split_offer_panel" ? "solid_bottom" : "bottom_gradient");
  const textZone = params.textZone ?? (textPanel === "solid_side" ? "right" : "bottom");

  return {
    specVersion: AD_PRESENTATION_SPEC_VERSION,
    templateId,
    themeId: cleanText(params.themeId) || "light_neutral",
    imageAssetId,
    imageSourceType,
    ...(params.focalPoint
      ? {
          focalPoint: {
            x: bounded01(params.focalPoint.x, 0.5),
            y: bounded01(params.focalPoint.y, 0.5),
          },
        }
      : {}),
    ...(normalizeCrop(params.crop) ? { crop: normalizeCrop(params.crop) } : {}),
    textPanel,
    textZone,
    showLogo: params.showLogo ?? false,
    showSupportingCopy: params.showSupportingCopy ?? true,
    showLiveStatus: params.showLiveStatus ?? true,
    showQuantityRemaining: params.showQuantityRemaining ?? true,
    showTimeRemaining: params.showTimeRemaining ?? true,
    resolutionReasonCodes: [...new Set((params.resolutionReasonCodes ?? []).map(cleanText).filter(Boolean))],
    rendererVersion: AD_COMPOSED_CARD_RENDERER_VERSION,
  };
}

export function validateAdPresentationSpec(value: unknown): AdPresentationValidationResult {
  const reasonCodes: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reasonCodes: ["NOT_OBJECT"] };
  }

  const spec = value as Partial<AdPresentationSpec>;
  if (spec.specVersion !== AD_PRESENTATION_SPEC_VERSION) reasonCodes.push("INVALID_SPEC_VERSION");
  if (!spec.templateId || !AD_PRESENTATION_TEMPLATE_IDS.includes(spec.templateId)) {
    reasonCodes.push("UNSUPPORTED_TEMPLATE");
  }
  if (!cleanText(spec.themeId)) reasonCodes.push("MISSING_THEME");
  if (!cleanText(spec.imageAssetId)) reasonCodes.push("MISSING_IMAGE_ASSET_ID");
  if (!spec.imageSourceType || !AD_PRESENTATION_IMAGE_SOURCE_TYPES.includes(spec.imageSourceType)) {
    reasonCodes.push("UNSUPPORTED_IMAGE_SOURCE");
  }
  if (!spec.textPanel || !AD_PRESENTATION_TEXT_PANELS.includes(spec.textPanel)) {
    reasonCodes.push("UNSUPPORTED_TEXT_PANEL");
  }
  if (!["top", "bottom", "left", "right"].includes(spec.textZone ?? "")) {
    reasonCodes.push("UNSUPPORTED_TEXT_ZONE");
  }
  if (spec.rendererVersion !== AD_COMPOSED_CARD_RENDERER_VERSION) reasonCodes.push("INVALID_RENDERER_VERSION");

  for (const key of ["showLogo", "showSupportingCopy", "showLiveStatus", "showQuantityRemaining", "showTimeRemaining"] as const) {
    if (typeof spec[key] !== "boolean") reasonCodes.push(`INVALID_${key.toUpperCase()}`);
  }

  if (spec.focalPoint) {
    if (
      !Number.isFinite(spec.focalPoint.x) ||
      !Number.isFinite(spec.focalPoint.y) ||
      spec.focalPoint.x < 0 ||
      spec.focalPoint.x > 1 ||
      spec.focalPoint.y < 0 ||
      spec.focalPoint.y > 1
    ) {
      reasonCodes.push("INVALID_FOCAL_POINT");
    }
  }

  if (spec.crop) {
    if (
      !Number.isFinite(spec.crop.x) ||
      !Number.isFinite(spec.crop.y) ||
      !Number.isFinite(spec.crop.width) ||
      !Number.isFinite(spec.crop.height) ||
      spec.crop.x < 0 ||
      spec.crop.y < 0 ||
      spec.crop.width <= 0 ||
      spec.crop.height <= 0 ||
      spec.crop.x + spec.crop.width > 1 ||
      spec.crop.y + spec.crop.height > 1
    ) {
      reasonCodes.push("INVALID_CROP");
    }
  }

  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}
