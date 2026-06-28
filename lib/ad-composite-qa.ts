import { validateAdPresentationSpec, type AdPresentationSpec } from "./ad-presentation-spec";
import type {
  ApprovedAdCopy,
  ComposedAdCardSurface,
  DealLiveState,
  ImmutableOfferFacts,
  MerchantDisplayIdentity,
} from "./ad-render-content";
import { estimateAdTextFit } from "./ad-text-fit";

export type AdCompositeQaRepairCode =
  | "SWITCH_TO_SPLIT"
  | "REMOVE_SUPPORTING_COPY"
  | "CHANGE_TEXT_PANEL"
  | "CHANGE_TEXT_ZONE"
  | "ADJUST_FOCAL_POINT"
  | "HIDE_LOGO"
  | "SHORTEN_HEADLINE";

export type AdCompositeQaDecision = "pass" | "repair" | "block" | "unavailable";

export type AdCompositeQaResult = {
  available: boolean;
  decision: AdCompositeQaDecision;
  hardFailReasons: string[];
  repairCodes: AdCompositeQaRepairCode[];
  scores: {
    offerReadability: number;
    visualUnity: number;
    productVisibility: number;
    hierarchy: number;
    contrast: number;
    mobileFit: number;
    professionalAppearance: number;
  };
  conciseFeedback: string[];
  screenshotQaTriggerCodes: string[];
};

export type AdCompositeQaInput = {
  offerFacts: ImmutableOfferFacts;
  merchant: MerchantDisplayIdentity;
  copy: ApprovedAdCopy;
  presentation: AdPresentationSpec;
  liveState: DealLiveState;
  surface: ComposedAdCardSurface;
  imageUri?: string | null;
  selectedImageAssetId?: string | null;
  imageSafeZoneConfidence?: number | null;
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function boundedScore(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function add<T extends string>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

function repairFromTextFit(code: string): AdCompositeQaRepairCode | null {
  if (code === "REMOVE_SUPPORTING_COPY") return "REMOVE_SUPPORTING_COPY";
  if (code === "SWITCH_TO_SAFE_TEMPLATE" || code === "USE_SPLIT_OFFER_PANEL") return "SWITCH_TO_SPLIT";
  if (code === "SHORTEN_HEADLINE") return "SHORTEN_HEADLINE";
  return null;
}

function placesTextOnImage(templateId: AdPresentationSpec["templateId"]): boolean {
  return (
    templateId === "hero_image_overlay" ||
    templateId === "social_moment_card" ||
    templateId === "signature_item_card"
  );
}

export function runDeterministicAdCompositeQa(input: AdCompositeQaInput): AdCompositeQaResult {
  const hardFailReasons: string[] = [];
  const repairCodes: AdCompositeQaRepairCode[] = [];
  const feedback: string[] = [];
  const screenshotQaTriggerCodes: string[] = [];
  const presentationValidation = validateAdPresentationSpec(input.presentation);
  const safeZoneConfidence = boundedScore(input.imageSafeZoneConfidence ?? 1);
  const hasVisualAsset = input.presentation.imageSourceType === "deterministic_fallback"
    ? true
    : Boolean(clean(input.imageUri) || clean(input.selectedImageAssetId) || clean(input.presentation.imageAssetId));

  if (!presentationValidation.valid) {
    hardFailReasons.push(...presentationValidation.reasonCodes.map((code) => `PRESENTATION_${code}`));
    feedback.push("Presentation metadata is invalid.");
  }
  if (!clean(input.offerFacts.primaryOfferLine)) {
    add(hardFailReasons, "MISSING_LOCKED_OFFER_LINE");
    feedback.push("The locked offer line is missing.");
  }
  if (!clean(input.merchant.name)) {
    add(hardFailReasons, "MISSING_MERCHANT_NAME");
    feedback.push("Merchant identity is missing.");
  }
  if (!clean(input.copy.headline)) {
    add(hardFailReasons, "MISSING_HEADLINE");
    feedback.push("The headline is missing.");
  }
  if (!clean(input.copy.ctaLabel)) {
    add(hardFailReasons, "MISSING_CTA");
    feedback.push("The CTA is missing.");
  }
  if (!hasVisualAsset) {
    add(hardFailReasons, "MISSING_APPROVED_IMAGE_ASSET");
    feedback.push("The selected visual asset is missing.");
  }
  if (
    clean(input.selectedImageAssetId) &&
    input.presentation.imageSourceType !== "deterministic_fallback" &&
    clean(input.presentation.imageAssetId) !== clean(input.selectedImageAssetId)
  ) {
    add(hardFailReasons, "SELECTED_IMAGE_ASSET_MISMATCH");
    feedback.push("The approved image asset does not match the presentation.");
  }

  if (input.presentation.templateId === "live_drop_card" && input.liveState.status !== "live") {
    add(repairCodes, "SWITCH_TO_SPLIT");
    feedback.push("Live template requested for a non-live state.");
  }
  if (placesTextOnImage(input.presentation.templateId)) {
    add(repairCodes, "SWITCH_TO_SPLIT");
    feedback.push("Text-over-image templates are not approved for deal previews.");
  }
  if (safeZoneConfidence < 0.58 && input.presentation.templateId !== "split_offer_panel") {
    add(repairCodes, "SWITCH_TO_SPLIT");
    add(screenshotQaTriggerCodes, "LOW_SAFE_ZONE_CONFIDENCE");
    feedback.push("Image safe-zone confidence is low; use the split panel.");
  }
  if (safeZoneConfidence < 0.72 && input.presentation.templateId !== "split_offer_panel") {
    add(screenshotQaTriggerCodes, "BORDERLINE_SAFE_ZONE_CONFIDENCE");
  }

  const fit = estimateAdTextFit({
    approvedCopy: input.copy,
    lockedOfferContent: input.offerFacts,
    merchantIdentity: input.merchant,
    templateId: input.presentation.templateId,
    ctaLabel: input.copy.ctaLabel,
    statusLabels: [
      input.presentation.showQuantityRemaining ? input.liveState.quantityRemainingLabel ?? "" : "",
      input.presentation.showTimeRemaining ? input.liveState.timeRemainingLabel ?? "" : "",
    ],
  });
  for (const code of fit.repairCodes) {
    const repair = repairFromTextFit(code);
    if (repair) add(repairCodes, repair);
  }
  if (!fit.fits) {
    add(screenshotQaTriggerCodes, "TEXT_FIT_REPAIR");
    feedback.push("Text fit requires a deterministic repair.");
  }
  if (!fit.offerFits && !input.offerFacts.compactOfferLine) {
    add(hardFailReasons, "LOCKED_OFFER_LINE_DOES_NOT_FIT");
    feedback.push("The locked offer line does not fit any safe form.");
  }

  const productVisibility = input.presentation.templateId === "split_offer_panel" ? 0.82 : safeZoneConfidence;
  const mobileFit = fit.fits ? 1 : repairCodes.includes("SWITCH_TO_SPLIT") ? 0.74 : 0.56;
  const decision: AdCompositeQaDecision =
    hardFailReasons.length > 0
      ? "block"
      : repairCodes.length > 0
        ? "repair"
        : "pass";

  return {
    available: true,
    decision,
    hardFailReasons: [...new Set(hardFailReasons)],
    repairCodes: [...new Set(repairCodes)],
    scores: {
      offerReadability: fit.offerFits ? 1 : 0.4,
      visualUnity: input.presentation.templateId === "split_offer_panel" ? 0.78 : 0.9,
      productVisibility,
      hierarchy: fit.headlineFits && fit.badgesFit ? 0.92 : 0.7,
      contrast: input.presentation.textPanel === "bottom_gradient" ? 0.82 : 0.92,
      mobileFit,
      professionalAppearance: decision === "pass" ? 0.92 : decision === "repair" ? 0.72 : 0.35,
    },
    conciseFeedback: [...new Set(feedback)],
    screenshotQaTriggerCodes: [...new Set(screenshotQaTriggerCodes)],
  };
}

export function shouldRunCompositeScreenshotQa(result: AdCompositeQaResult): boolean {
  return result.decision === "repair" || result.screenshotQaTriggerCodes.length > 0;
}
