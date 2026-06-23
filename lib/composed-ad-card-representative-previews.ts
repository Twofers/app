import { createAdPresentationHash } from "./ad-presentation-hash";
import type { AdImageSourceType, AdLayoutTemplateId, AdPresentationSpec } from "./ad-presentation-spec";
import type { ApprovedAdCopy, DealLiveState, MerchantDisplayIdentity } from "./ad-render-content";
import { runDeterministicAdCompositeQa, type AdCompositeQaResult } from "./ad-composite-qa";
import { resolveAdPresentation } from "./ad-template-resolver";
import type { LockedOfferContent } from "./authoritative-offer-renderer";
import { buildImageSafeZoneResult } from "./image-safe-zone";
import type { SourceAwareImageQaResult } from "./quick-deal-image-qa";

export type RepresentativeComposedAdPreviewId =
  | "coffee-drink-offer"
  | "pastry-offer"
  | "meal-multiple-items"
  | "beauty-service-offer"
  | "clean-negative-space"
  | "busy-background"
  | "storefront-image"
  | "logo-forward-image"
  | "generated-image"
  | "ai-edited-photo"
  | "very-long-merchant-name"
  | "long-exact-item-names"
  | "live-quantity-limited"
  | "scheduled-deal"
  | "ended-deal"
  | "no-photo-deterministic-fallback";

export type ComposedAdRepresentativePreviewCase = {
  id: RepresentativeComposedAdPreviewId;
  description: string;
  offerFacts: LockedOfferContent;
  merchant: MerchantDisplayIdentity;
  copy: ApprovedAdCopy;
  imageAssetId: string;
  imageUri: string | null;
  imageSourceType: AdImageSourceType;
  imageQa: SourceAwareImageQaResult;
  imageSafeZoneConfidence: number;
  creativeStrategy: string;
  liveState: DealLiveState;
  liveStateCapabilities: {
    supportsQuantityRemaining: boolean;
    supportsTimeRemaining: boolean;
  };
  recentTemplateIds?: AdLayoutTemplateId[];
};

export type ResolvedRepresentativeComposedAdPreview = {
  caseId: RepresentativeComposedAdPreviewId;
  presentation: AdPresentationSpec;
  presentationHash: string;
  resolutionReasonCodes: string[];
  recommendedTemplateId: AdLayoutTemplateId;
  alternateTemplateIds: AdLayoutTemplateId[];
  compositeQa: AdCompositeQaResult;
};

function offer(primaryOfferLine: string, termsLine = "Valid in store during the listed deal window."): LockedOfferContent {
  return {
    primaryOfferLine,
    compactOfferLine: primaryOfferLine,
    termsLine,
    accessibilityOfferDescription: `${primaryOfferLine} ${termsLine}`,
  };
}

function copy(headline: string, supportingCopy: string, ctaLabel = "Claim deal"): ApprovedAdCopy {
  return { headline, supportingCopy, ctaLabel };
}

function merchant(name: string, options?: Partial<MerchantDisplayIdentity>): MerchantDisplayIdentity {
  return {
    name,
    locationName: options?.locationName ?? "Main Street",
    addressLine: options?.addressLine ?? "123 Main Street",
    logoUri: options?.logoUri ?? null,
    logoVerified: options?.logoVerified === true,
  };
}

function imageQa(params: {
  sourceType: AdImageSourceType;
  decision?: SourceAwareImageQaResult["decision"];
  warningCodes?: string[];
  hardFailReasons?: string[];
}): SourceAwareImageQaResult {
  return {
    checked: params.sourceType !== "deterministic_fallback",
    available: true,
    sourceType: params.sourceType,
    decision: params.decision ?? (params.warningCodes?.length ? "warn" : "pass"),
    hardFailReasons: params.hardFailReasons ?? [],
    warningCodes: params.warningCodes ?? [],
    missingItems: [],
    forbiddenElements: [],
    merchantOverrideAllowed: params.sourceType === "merchant_original",
    merchantOverrideAcknowledged: params.sourceType === "merchant_original",
    notes: "",
  };
}

function liveState(
  status: DealLiveState["status"],
  statusLabel: string,
  quantityRemainingLabel?: string | null,
  timeRemainingLabel?: string | null,
): DealLiveState {
  return {
    status,
    statusLabel,
    quantityRemainingLabel,
    timeRemainingLabel,
    claimAvailable: status === "live" || status === "starts_soon",
  };
}

function previewCase(
  input: Omit<ComposedAdRepresentativePreviewCase, "imageQa" | "liveState" | "liveStateCapabilities"> & {
    imageQa?: SourceAwareImageQaResult;
    liveState?: DealLiveState;
    liveStateCapabilities?: ComposedAdRepresentativePreviewCase["liveStateCapabilities"];
  },
): ComposedAdRepresentativePreviewCase {
  return {
    ...input,
    imageQa: input.imageQa ?? imageQa({ sourceType: input.imageSourceType }),
    liveState: input.liveState ?? liveState("live", "Live now", null, null),
    liveStateCapabilities: input.liveStateCapabilities ?? {
      supportsQuantityRemaining: false,
      supportsTimeRemaining: false,
    },
  };
}

export function buildRepresentativeComposedAdPreviewCases(): ComposedAdRepresentativePreviewCase[] {
  return [
    previewCase({
      id: "coffee-drink-offer",
      description: "Coffee drink offer",
      offerFacts: offer("Buy 1 iced latte; get 1 more."),
      merchant: merchant("Grounds Cafe"),
      copy: copy("Afternoon latte run", "A cold coffee pause for the middle of the day."),
      imageAssetId: "fixtures/coffee-drink-offer.jpg",
      imageUri: "https://example.invalid/coffee-drink-offer.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.9,
      creativeStrategy: "signature item hero image",
    }),
    previewCase({
      id: "pastry-offer",
      description: "Pastry offer",
      offerFacts: offer("Buy 2 croissants; get 1 cappuccino."),
      merchant: merchant("Butterline Bakery"),
      copy: copy("Fresh from the case", "Pair something flaky with a warm coffee."),
      imageAssetId: "fixtures/pastry-offer.jpg",
      imageUri: "https://example.invalid/pastry-offer.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.86,
      creativeStrategy: "morning bakery moment",
      recentTemplateIds: ["hero_image_overlay"],
    }),
    previewCase({
      id: "meal-multiple-items",
      description: "Meal with multiple required items",
      offerFacts: offer("Buy 1 breakfast sandwich; get 2 cookies."),
      merchant: merchant("Sunrise Counter"),
      copy: copy("Breakfast with a bonus", "A savory start with something sweet to share."),
      imageAssetId: "fixtures/meal-multiple-items.jpg",
      imageUri: "https://example.invalid/meal-multiple-items.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.79,
      creativeStrategy: "social moment combo",
      recentTemplateIds: ["hero_image_overlay"],
    }),
    previewCase({
      id: "beauty-service-offer",
      description: "Beauty or service offer",
      offerFacts: offer("Book 1 brow shaping; get 1 tint add-on."),
      merchant: merchant("Cedar Studio"),
      copy: copy("A polished little reset", "Book a quick appointment and leave a little brighter."),
      imageAssetId: "fixtures/beauty-service-offer.jpg",
      imageUri: "https://example.invalid/beauty-service-offer.jpg",
      imageSourceType: "approved_stock",
      imageSafeZoneConfidence: 0.76,
      creativeStrategy: "clean local service discovery",
      recentTemplateIds: ["hero_image_overlay"],
    }),
    previewCase({
      id: "clean-negative-space",
      description: "Merchant original with clean negative space",
      offerFacts: offer("Buy 1 matcha latte; get 1 cookie."),
      merchant: merchant("Matcha House"),
      copy: copy("Green tea break", "A calm afternoon pairing with room to breathe."),
      imageAssetId: "fixtures/clean-negative-space.jpg",
      imageUri: "https://example.invalid/clean-negative-space.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.94,
      creativeStrategy: "hero image with clean negative space",
    }),
    previewCase({
      id: "busy-background",
      description: "Merchant original with busy background",
      offerFacts: offer("Buy 1 turkey croissant; get kettle chips."),
      merchant: merchant("Corner Lunch"),
      copy: copy("Lunch, handled", "A quick bite with a crunchy side."),
      imageAssetId: "fixtures/busy-background.jpg",
      imageUri: "https://example.invalid/busy-background.jpg",
      imageSourceType: "merchant_original",
      imageQa: imageQa({ sourceType: "merchant_original", warningCodes: ["CROP_OR_OVERLAY_RISK"] }),
      imageSafeZoneConfidence: 0.38,
      creativeStrategy: "busy counter photo",
    }),
    previewCase({
      id: "storefront-image",
      description: "Storefront image",
      offerFacts: offer("Buy 1 rice bowl; get 1 green tea."),
      merchant: merchant("Local Bowl Shop"),
      copy: copy("A neighborhood lunch stop", "Drop in for a bowl and a tea."),
      imageAssetId: "fixtures/storefront-image.jpg",
      imageUri: "https://example.invalid/storefront-image.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.82,
      creativeStrategy: "local storefront neighborhood discovery",
      recentTemplateIds: ["hero_image_overlay"],
    }),
    previewCase({
      id: "logo-forward-image",
      description: "Logo-forward image",
      offerFacts: offer("Buy 1 bagel; get 1 schmear."),
      merchant: merchant("Bagel Works", { logoUri: "https://example.invalid/logo.png", logoVerified: true }),
      copy: copy("Bagel morning", "A classic breakfast pair from a familiar local counter."),
      imageAssetId: "fixtures/logo-forward-image.jpg",
      imageUri: "https://example.invalid/logo-forward-image.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.8,
      creativeStrategy: "logo forward local discovery",
      recentTemplateIds: ["hero_image_overlay"],
    }),
    previewCase({
      id: "generated-image",
      description: "Generated image",
      offerFacts: offer("Buy 1 mango smoothie; get 1 more."),
      merchant: merchant("Blend Bar"),
      copy: copy("Smoothie weather", "Two bright drinks for a sunny stop."),
      imageAssetId: "fixtures/generated-image.jpg",
      imageUri: "https://example.invalid/generated-image.jpg",
      imageSourceType: "ai_generated",
      imageSafeZoneConfidence: 0.78,
      creativeStrategy: "bright social moment",
      recentTemplateIds: ["hero_image_overlay"],
    }),
    previewCase({
      id: "ai-edited-photo",
      description: "AI-edited merchant photo",
      offerFacts: offer("Buy 1 avocado toast; get orange juice."),
      merchant: merchant("Toast & Co."),
      copy: copy("Brunch gets brighter", "A polished plate with a citrus finish."),
      imageAssetId: "fixtures/ai-edited-photo.jpg",
      imageUri: "https://example.invalid/ai-edited-photo.jpg",
      imageSourceType: "merchant_ai_edit",
      imageSafeZoneConfidence: 0.74,
      creativeStrategy: "studio polish item-led",
      recentTemplateIds: ["hero_image_overlay"],
    }),
    previewCase({
      id: "very-long-merchant-name",
      description: "Very long merchant name",
      offerFacts: offer("Buy 1 drip coffee; get 1 scone."),
      merchant: merchant("The Original Downtown Neighborhood Coffee Roasters Collective"),
      copy: copy("Coffee and a little extra", "A simple morning pair from the counter."),
      imageAssetId: "fixtures/very-long-merchant-name.jpg",
      imageUri: "https://example.invalid/very-long-merchant-name.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.7,
      creativeStrategy: "clean hero image",
    }),
    previewCase({
      id: "long-exact-item-names",
      description: "Long exact item names",
      offerFacts: offer("Buy 1 seasonal roasted vegetable breakfast sandwich with chipotle aioli; get 1 house drip coffee."),
      merchant: merchant("Elm Cafe"),
      copy: copy("A full-flavor breakfast stop", "A hearty sandwich with coffee alongside it."),
      imageAssetId: "fixtures/long-exact-item-names.jpg",
      imageUri: "https://example.invalid/long-exact-item-names.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.66,
      creativeStrategy: "signature item",
    }),
    previewCase({
      id: "live-quantity-limited",
      description: "Live quantity-limited deal",
      offerFacts: offer("Buy 1 cupcake; get 1 mini cupcake."),
      merchant: merchant("Frosting Table"),
      copy: copy("Small batch sweets", "A limited tray while the afternoon batch lasts."),
      imageAssetId: "fixtures/live-quantity-limited.jpg",
      imageUri: "https://example.invalid/live-quantity-limited.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.88,
      creativeStrategy: "live drop limited quantity",
      liveState: liveState("live", "Live now", "12 left", "Ends in 45 min"),
      liveStateCapabilities: {
        supportsQuantityRemaining: true,
        supportsTimeRemaining: true,
      },
    }),
    previewCase({
      id: "scheduled-deal",
      description: "Scheduled deal",
      offerFacts: offer("Buy 1 panini; get 1 cup of soup."),
      merchant: merchant("Noon Press"),
      copy: copy("Lunch is lined up", "A warm midday pair when the window opens."),
      imageAssetId: "fixtures/scheduled-deal.jpg",
      imageUri: "https://example.invalid/scheduled-deal.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.84,
      creativeStrategy: "scheduled lunch local discovery",
      liveState: liveState("starts_soon", "Starts soon", null, "Starts at noon"),
    }),
    previewCase({
      id: "ended-deal",
      description: "Ended deal",
      offerFacts: offer("Buy 1 donut; get 1 more."),
      merchant: merchant("Glaze Stop"),
      copy: copy("Donut break", "A simple sweet pair for the next batch."),
      imageAssetId: "fixtures/ended-deal.jpg",
      imageUri: "https://example.invalid/ended-deal.jpg",
      imageSourceType: "merchant_original",
      imageSafeZoneConfidence: 0.84,
      creativeStrategy: "ended deal safe detail view",
      liveState: liveState("ended", "Ended", null, "Ended today"),
    }),
    previewCase({
      id: "no-photo-deterministic-fallback",
      description: "No-photo deterministic fallback",
      offerFacts: offer("Get 50% off 1 latte."),
      merchant: merchant("Oak Street Coffee"),
      copy: copy("Half-price latte window", "A simple reason to stop in today."),
      imageAssetId: "deterministic-fallback",
      imageUri: null,
      imageSourceType: "deterministic_fallback",
      imageSafeZoneConfidence: 1,
      creativeStrategy: "fallback card",
    }),
  ];
}

export function resolveRepresentativeComposedAdPreview(
  preview: ComposedAdRepresentativePreviewCase,
): ResolvedRepresentativeComposedAdPreview {
  const imageSafeZones = buildImageSafeZoneResult({
    hasImage: preview.imageUri !== null,
    imageSourceType: preview.imageSourceType,
    imageQa: preview.imageQa,
    cropSuitabilityScore: preview.imageSafeZoneConfidence,
  });
  const resolution = resolveAdPresentation({
    approvedCopy: preview.copy,
    lockedOfferContent: preview.offerFacts,
    merchantIdentity: preview.merchant,
    imageQa: preview.imageQa,
    imageSafeZones,
    creativeStrategy: preview.creativeStrategy,
    liveStateCapabilities: preview.liveStateCapabilities,
    targetSurface: "merchant_preview",
    recentTemplateIds: preview.recentTemplateIds,
    imageAssetId: preview.imageAssetId,
    imageSourceType: preview.imageSourceType,
    themeId: "light_neutral",
  });
  const presentation = resolution.recommended;
  const compositeQa = runDeterministicAdCompositeQa({
    offerFacts: preview.offerFacts,
    merchant: preview.merchant,
    copy: preview.copy,
    presentation,
    liveState: preview.liveState,
    surface: "merchant_preview",
    imageUri: preview.imageUri,
    selectedImageAssetId: preview.imageAssetId,
    imageSafeZoneConfidence: preview.imageSafeZoneConfidence,
  });

  return {
    caseId: preview.id,
    presentation,
    presentationHash: createAdPresentationHash({
      presentation,
      offerFacts: preview.offerFacts,
      copy: preview.copy,
    }),
    resolutionReasonCodes: resolution.reasonCodes,
    recommendedTemplateId: presentation.templateId,
    alternateTemplateIds: resolution.alternates.map((alternate) => alternate.templateId),
    compositeQa,
  };
}
