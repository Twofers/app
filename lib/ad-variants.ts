/**
 * AI-generated ad options for the business create flow.
 * Server returns exactly 3 variants per request (see ai-generate-ad-variants).
 */

export type CreativeLane = "value" | "neighborhood" | "premium";

export type GeneratedAd = {
  /** Fixed creative lane (order: value → neighborhood → premium) */
  creative_lane: CreativeLane;
  headline: string;
  subheadline: string;
  cta: string;
  style_label: string;
  rationale: string;
  /** Notes for future image gen; may be empty */
  visual_direction: string;
};

export const CREATIVE_LANE_ORDER: CreativeLane[] = ["value", "neighborhood", "premium"];

export const CREATIVE_LANE_LABEL: Record<CreativeLane, string> = {
  value: "Value",
  neighborhood: "Neighborhood",
  premium: "Premium / quality",
};

export type BusinessContextPayload = {
  /** e.g. Coffee shop — optional until profile supports it */
  category?: string;
  tone?: string;
  location?: string;
  description?: string;
};

export type GenerateAdVariantsResponse = {
  ads: GeneratedAd[];
};

/** Single string stored on `deals.description` / templates (consumer sees one block). */
export function composeListingDescription(promo: string, cta: string, offerDetails: string): string {
  return [promo.trim(), cta.trim(), offerDetails.trim()].filter(Boolean).join("\n\n");
}

/**
 * Map a chosen ad into draft fields. Offer details default to the owner’s hint (ground truth).
 */
export function adToDealDraft(ad: GeneratedAd, ownerOfferHint: string): {
  title: string;
  promo_line: string;
  cta_text: string;
  offer_details: string;
} {
  const hint = ownerOfferHint.trim();
  return {
    title: ad.headline.trim(),
    promo_line: ad.subheadline.trim(),
    cta_text: ad.cta.trim(),
    offer_details: hint || [ad.subheadline, ad.cta].filter(Boolean).join("\n\n"),
  };
}
