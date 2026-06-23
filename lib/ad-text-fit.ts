import type { AdLayoutTemplateId } from "./ad-presentation-spec";
import type { ApprovedAdCopy, MerchantDisplayIdentity } from "./ad-render-content";
import type { LockedOfferContent } from "./authoritative-offer-renderer";

export type AdTextFitRepairCode =
  | "USE_COMPACT_OFFER_LINE"
  | "REMOVE_SUPPORTING_COPY"
  | "SWITCH_TO_SAFE_TEMPLATE"
  | "USE_SPLIT_OFFER_PANEL"
  | "SHORTEN_HEADLINE";

export type AdTextFitInput = {
  approvedCopy: ApprovedAdCopy;
  lockedOfferContent: LockedOfferContent;
  merchantIdentity: MerchantDisplayIdentity;
  templateId: AdLayoutTemplateId;
  ctaLabel: string;
  statusLabels?: string[];
};

export type AdTextFitResult = {
  fits: boolean;
  headlineFits: boolean;
  offerFits: boolean;
  merchantFits: boolean;
  ctaFits: boolean;
  badgesFit: boolean;
  showSupportingCopy: boolean;
  offerLine: string;
  recommendedTemplateId: AdLayoutTemplateId;
  repairCodes: AdTextFitRepairCode[];
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function templateCapacity(templateId: AdLayoutTemplateId): {
  headline: number;
  offer: number;
  supporting: number;
  merchant: number;
  cta: number;
  badgeTotal: number;
} {
  if (templateId === "split_offer_panel") {
    return { headline: 64, offer: 84, supporting: 120, merchant: 44, cta: 28, badgeTotal: 54 };
  }
  if (templateId === "live_drop_card") {
    return { headline: 54, offer: 76, supporting: 94, merchant: 34, cta: 24, badgeTotal: 42 };
  }
  if (templateId === "local_discovery_card") {
    return { headline: 58, offer: 78, supporting: 92, merchant: 42, cta: 24, badgeTotal: 46 };
  }
  if (templateId === "signature_item_card") {
    return { headline: 52, offer: 72, supporting: 76, merchant: 34, cta: 24, badgeTotal: 42 };
  }
  if (templateId === "social_moment_card") {
    return { headline: 56, offer: 76, supporting: 90, merchant: 36, cta: 24, badgeTotal: 44 };
  }
  return { headline: 52, offer: 72, supporting: 88, merchant: 34, cta: 24, badgeTotal: 42 };
}

export function estimateAdTextFit(input: AdTextFitInput): AdTextFitResult {
  const caps = templateCapacity(input.templateId);
  const repairCodes: AdTextFitRepairCode[] = [];
  const headline = clean(input.approvedCopy.headline);
  const primaryOffer = clean(input.lockedOfferContent.primaryOfferLine);
  const compactOffer = clean(input.lockedOfferContent.compactOfferLine) || primaryOffer;
  const supporting = clean(input.approvedCopy.supportingCopy);
  const merchant = clean(input.merchantIdentity.name);
  const cta = clean(input.ctaLabel);
  const badgesLength = (input.statusLabels ?? []).map(clean).filter(Boolean).join(" ").length;

  let offerLine = primaryOffer;
  let offerFits = primaryOffer.length <= caps.offer;
  if (!offerFits && compactOffer.length <= caps.offer) {
    offerLine = compactOffer;
    offerFits = true;
    repairCodes.push("USE_COMPACT_OFFER_LINE");
  }

  let showSupportingCopy = supporting.length > 0 && supporting.length <= caps.supporting;
  if (supporting.length > caps.supporting || (!offerFits && supporting.length > 0)) {
    showSupportingCopy = false;
    repairCodes.push("REMOVE_SUPPORTING_COPY");
  }

  const headlineFits = headline.length <= caps.headline;
  const merchantFits = merchant.length <= caps.merchant;
  const ctaFits = cta.length <= caps.cta;
  const badgesFit = badgesLength <= caps.badgeTotal;
  const fits = headlineFits && offerFits && merchantFits && ctaFits && badgesFit;

  let recommendedTemplateId = input.templateId;
  if (!fits && input.templateId !== "split_offer_panel") {
    recommendedTemplateId = "split_offer_panel";
    repairCodes.push("SWITCH_TO_SAFE_TEMPLATE");
  }
  if (!headlineFits && input.templateId === "split_offer_panel") repairCodes.push("SHORTEN_HEADLINE");
  if ((!offerFits || !merchantFits || !ctaFits || !badgesFit) && recommendedTemplateId === "split_offer_panel") {
    repairCodes.push("USE_SPLIT_OFFER_PANEL");
  }

  return {
    fits,
    headlineFits,
    offerFits,
    merchantFits,
    ctaFits,
    badgesFit,
    showSupportingCopy,
    offerLine,
    recommendedTemplateId,
    repairCodes: [...new Set(repairCodes)],
  };
}
