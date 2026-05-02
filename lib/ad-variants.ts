/**
 * Single-ad shape returned by the ai-generate-ad-variants edge function.
 * The 3-lane variants flow was removed in the 2026-05-01 quality rewrite.
 */

export type PhotoTreatment = "touchup" | "cleanbg" | "studiopolish";

export type ItemResearch = {
  item_name: string;
  description: string;
  is_familiar: boolean;
};

export type GeneratedAd = {
  headline: string;
  subheadline: string;
  cta: string;
  /** Storage path in deal-photos bucket; null if image production failed. */
  poster_storage_path?: string | null;
  /** Web-research context the AI used to write the copy. Empty when research returned nothing. */
  item_research?: ItemResearch;
  /** How the image was produced. */
  photo_source?: "uploaded_original" | "uploaded_enhanced" | "generated";
  /** Which enhancement was applied (only meaningful when photo_source = "uploaded_enhanced"). */
  photo_treatment?: PhotoTreatment | null;
};

export type BusinessContextPayload = {
  /** e.g. Coffee shop — optional until profile supports it */
  category?: string;
  tone?: string;
  location?: string;
  address?: string;
  description?: string;
  contactName?: string;
  businessEmail?: string;
};

export type GenerateAdResponse = {
  ad: GeneratedAd;
  /** Backward-compat alias for legacy callers expecting an array. */
  ads?: GeneratedAd[];
};

/** Single string stored on `deals.description` / templates (consumer sees one block). */
export function composeListingDescription(promo: string, cta: string, offerDetails: string): string {
  return [promo.trim(), cta.trim(), offerDetails.trim()].filter(Boolean).join("\n\n");
}

/**
 * Map a chosen ad into draft fields. Offer details default to the owner's hint (ground truth).
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
