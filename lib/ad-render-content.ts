import type { GeneratedAd } from "./ad-variants";
import type { AdImageSourceType } from "./ad-presentation-spec";
import type { LockedOfferContent } from "./authoritative-offer-renderer";

export type ImmutableOfferFacts = LockedOfferContent & {
  priceLabel?: string | null;
  scheduleSummary?: string | null;
};

export type MerchantDisplayIdentity = {
  name: string;
  locationName?: string | null;
  addressLine?: string | null;
  logoUri?: string | null;
  logoVerified?: boolean;
};

export type ApprovedAdCopy = {
  headline: string;
  supportingCopy?: string | null;
  ctaLabel: string;
  imageAltText?: string | null;
};

export type DealLiveState = {
  status: "live" | "starts_soon" | "ended" | "claimed" | "redeemed" | "unavailable";
  statusLabel: string;
  quantityRemainingLabel?: string | null;
  timeRemainingLabel?: string | null;
  claimAvailable: boolean;
};

export type ComposedAdCardSurface = "merchant_preview" | "consumer_feed" | "deal_detail";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function buildApprovedAdCopy(params: {
  headline?: string | null;
  supportingCopy?: string | null;
  ctaLabel?: string | null;
  fallbackHeadline: string;
}): ApprovedAdCopy {
  const headline = cleanText(params.headline) || cleanText(params.fallbackHeadline) || "Fresh local offer";
  return {
    headline,
    supportingCopy: cleanText(params.supportingCopy) || null,
    ctaLabel: cleanText(params.ctaLabel) || "Claim deal",
  };
}

export function imageSourceTypeFromGeneratedAd(ad: GeneratedAd | null | undefined): AdImageSourceType {
  if (!ad) return "deterministic_fallback";
  const storagePath = ad.poster_storage_path?.trim() || ad.image_selection?.selectedStoragePath?.trim() || "";
  if (!storagePath) return "deterministic_fallback";
  if (ad.image_selection?.sourceMode && ad.image_selection.sourceMode !== "deterministic_fallback") {
    return ad.image_selection.sourceMode;
  }
  if (ad.photo_source === "uploaded_enhanced") return "merchant_ai_edit";
  if (ad.photo_source === "generated") return "ai_generated";
  if (ad.photo_source === "stock") return "approved_stock";
  if (ad.photo_source === "fallback_template" || ad.photo_source === "copy_only") return "deterministic_fallback";
  return "merchant_original";
}

export function buildMerchantIdentity(params: {
  businessName?: string | null;
  locationName?: string | null;
  addressLine?: string | null;
  logoUri?: string | null;
  logoVerified?: boolean;
}): MerchantDisplayIdentity {
  return {
    name: cleanText(params.businessName) || "Local business",
    locationName: cleanText(params.locationName) || null,
    addressLine: cleanText(params.addressLine) || null,
    logoUri: cleanText(params.logoUri) || null,
    logoVerified: params.logoVerified === true,
  };
}
