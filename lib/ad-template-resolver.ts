import {
  buildDefaultAdPresentationSpec,
  type AdImageSourceType,
  type AdLayoutTemplateId,
  type AdPresentationSpec,
} from "./ad-presentation-spec";
import { resolveAdCrop } from "./ad-crop-resolver";
import { estimateAdTextFit } from "./ad-text-fit";
import type { ApprovedAdCopy, ComposedAdCardSurface, MerchantDisplayIdentity } from "./ad-render-content";
import type { LockedOfferContent } from "./authoritative-offer-renderer";
import type { ImageSafeZoneResult } from "./image-safe-zone";
import type { SourceAwareImageQaResult } from "./quick-deal-image-qa";

export type TemplateResolutionInput = {
  approvedCopy: ApprovedAdCopy;
  lockedOfferContent: LockedOfferContent;
  merchantIdentity: MerchantDisplayIdentity;
  imageQa: SourceAwareImageQaResult;
  imageSafeZones: ImageSafeZoneResult;
  creativeStrategy: string;
  liveStateCapabilities: {
    supportsQuantityRemaining: boolean;
    supportsTimeRemaining: boolean;
  };
  targetSurface: ComposedAdCardSurface;
  recentTemplateIds?: AdLayoutTemplateId[];
  imageAssetId?: string | null;
  imageSourceType?: AdImageSourceType | null;
  themeId?: string | null;
};

export type TemplateResolutionResult = {
  recommended: AdPresentationSpec;
  alternates: AdPresentationSpec[];
  reasonCodes: string[];
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function strategyIncludes(strategy: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(strategy));
}

function uniqueTemplates(values: AdLayoutTemplateId[]): AdLayoutTemplateId[] {
  return values.filter((value, index, list) => list.indexOf(value) === index);
}

function imageSourceTypeFromQa(input: TemplateResolutionInput): AdImageSourceType {
  return input.imageSourceType ?? input.imageQa.sourceType ?? "deterministic_fallback";
}

function buildSpec(input: TemplateResolutionInput, templateId: AdLayoutTemplateId, reasonCodes: string[]): AdPresentationSpec {
  const crop = resolveAdCrop({
    imageSafeZones: input.imageSafeZones,
    templateId,
  });
  const textPanel =
    templateId === "split_offer_panel"
      ? "solid_bottom"
      : crop.textZone === "right" || crop.textZone === "left"
        ? "solid_side"
        : templateId === "hero_image_overlay"
          ? "bottom_gradient"
          : "solid_bottom";
  return buildDefaultAdPresentationSpec({
    imageAssetId: input.imageAssetId,
    imageSourceType: imageSourceTypeFromQa(input),
    templateId,
    themeId: input.themeId,
    crop: crop.crop,
    focalPoint: crop.focalPoint,
    textPanel,
    textZone: crop.textZone,
    showLogo: input.merchantIdentity.logoVerified === true,
    showSupportingCopy: !reasonCodes.includes("REMOVE_SUPPORTING_COPY"),
    showLiveStatus: true,
    showQuantityRemaining: input.liveStateCapabilities.supportsQuantityRemaining,
    showTimeRemaining: input.liveStateCapabilities.supportsTimeRemaining,
    resolutionReasonCodes: [...reasonCodes, ...crop.repairCodes],
  });
}

function textFitReasonCodes(input: TemplateResolutionInput, templateId: AdLayoutTemplateId): string[] {
  const fit = estimateAdTextFit({
    approvedCopy: input.approvedCopy,
    lockedOfferContent: input.lockedOfferContent,
    merchantIdentity: input.merchantIdentity,
    templateId,
    ctaLabel: input.approvedCopy.ctaLabel,
    statusLabels: [
      input.liveStateCapabilities.supportsQuantityRemaining ? "12 left" : "",
      input.liveStateCapabilities.supportsTimeRemaining ? "Ends soon" : "",
    ],
  });
  return fit.repairCodes;
}

export function resolveAdPresentation(input: TemplateResolutionInput): TemplateResolutionResult {
  const reasonCodes: string[] = [];
  const strategy = clean(input.creativeStrategy).toLowerCase();
  const hasUsableImage = input.imageSafeZones.available && imageSourceTypeFromQa(input) !== "deterministic_fallback";
  const lowConfidence = input.imageSafeZones.confidence < 0.58 || input.imageQa.decision === "block";
  const liveCapable = input.liveStateCapabilities.supportsQuantityRemaining || input.liveStateCapabilities.supportsTimeRemaining;

  reasonCodes.push(...input.imageSafeZones.reasonCodes);
  if (!hasUsableImage) reasonCodes.push("NO_USABLE_IMAGE");
  if (lowConfidence) reasonCodes.push("LOW_IMAGE_SAFE_ZONE_CONFIDENCE");
  if (input.imageQa.decision === "warn") reasonCodes.push("IMAGE_QA_WARNING");
  if (input.imageQa.decision === "block") reasonCodes.push("IMAGE_QA_BLOCKED");

  const preferred: AdLayoutTemplateId[] = [];
  if (hasUsableImage && liveCapable && !lowConfidence) preferred.push("live_drop_card");
  if (hasUsableImage && strategyIncludes(strategy, [/local/, /nearby/, /neighborhood/, /storefront/, /discovery/])) preferred.push("local_discovery_card");
  preferred.push("split_offer_panel");

  const recent = new Set(input.recentTemplateIds ?? []);
  const candidates = uniqueTemplates(preferred).sort((a, b) => {
    const aRecent = recent.has(a) && a !== "split_offer_panel" ? 1 : 0;
    const bRecent = recent.has(b) && b !== "split_offer_panel" ? 1 : 0;
    return aRecent - bRecent;
  });

  let recommendedTemplateId = candidates[0] ?? "split_offer_panel";
  if (!hasUsableImage || lowConfidence) recommendedTemplateId = "split_offer_panel";

  const fitCodes = textFitReasonCodes(input, recommendedTemplateId);
  if (fitCodes.includes("SWITCH_TO_SAFE_TEMPLATE") || fitCodes.includes("USE_SPLIT_OFFER_PANEL")) {
    recommendedTemplateId = "split_offer_panel";
    reasonCodes.push(...fitCodes);
  }
  if (fitCodes.includes("REMOVE_SUPPORTING_COPY")) reasonCodes.push("REMOVE_SUPPORTING_COPY");

  const recommended = buildSpec(input, recommendedTemplateId, [...new Set(reasonCodes)]);
  const alternates = candidates
    .filter((candidate) => candidate !== recommendedTemplateId)
    .map((candidate) => ({
      templateId: candidate,
      fitCodes: textFitReasonCodes(input, candidate),
    }))
    .filter(({ templateId, fitCodes }) => {
      if (!hasUsableImage && templateId !== "split_offer_panel") return false;
      if (templateId === "live_drop_card" && !liveCapable) return false;
      if (lowConfidence && templateId !== "split_offer_panel") return false;
      return !fitCodes.includes("SHORTEN_HEADLINE") && !fitCodes.includes("USE_SPLIT_OFFER_PANEL");
    })
    .slice(0, 2)
    .map(({ templateId, fitCodes }) => buildSpec(input, templateId, ["ALTERNATE_STYLE", ...input.imageSafeZones.reasonCodes, ...fitCodes]));

  return {
    recommended,
    alternates,
    reasonCodes: recommended.resolutionReasonCodes,
  };
}
