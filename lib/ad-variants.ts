/**
 * Single-ad shape returned by the ai-generate-ad-variants edge function.
 * The 3-lane variants flow was removed in the 2026-05-01 quality rewrite.
 */

import { getDealDisplayTitle } from "./deal-display-copy";
import { DEAL_COPY_LIMITS } from "./deal-offer-contract";
import {
  buildOfferDisclosureLine,
  canonicalOfferSentence,
  type OfferDefinitionV1,
} from "./offer-definition";

export type PhotoTreatment = "touchup" | "cleanbg" | "studiopolish";

export type ItemResearch = {
  item_name: string;
  description: string;
  is_familiar: boolean;
};

export type GeneratedAd = {
  headline: string;
  subheadline: string;
  short_description?: string;
  push_notification?: string;
  terms_summary?: string;
  social_caption?: string;
  locked_offer_line?: string;
  locked_terms_line?: string;
  copy_source?: "AI_VALIDATED" | "AI_RETRY_VALIDATED" | "DETERMINISTIC_FALLBACK";
  variant_count?: number;
  selected_variant_index?: number | null;
  validation_reason_codes?: string[];
  cta: string;
  /** Storage path in deal-photos bucket; null if image production failed. */
  poster_storage_path?: string | null;
  /** Web-research context the AI used to write the copy. Empty when research returned nothing. */
  item_research?: ItemResearch;
  /** How the image was produced. */
  photo_source?: "uploaded_original" | "uploaded_enhanced" | "generated" | "fallback_template";
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

function containsMechanicalOfferLanguage(value: string): boolean {
  return /\bBOGO\b|\bSame[-\s]?Item\b|\b2\s*[- ]?\s*for\s*[- ]?\s*1\b|\btwo\s+for\s+one\b/i.test(value);
}

export function normalizeGeneratedAdDisplayCopy(ad: GeneratedAd): GeneratedAd {
  const headline = getDealDisplayTitle({ title: ad.headline }, ad.headline);
  const push = ad.push_notification?.trim() ?? "";
  return {
    ...ad,
    headline,
    push_notification: push ? (containsMechanicalOfferLanguage(push) ? headline : push) : ad.push_notification,
  };
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
  const shortDescription = (ad.short_description ?? ad.subheadline).trim();
  const termsSummary = ad.terms_summary?.trim() ?? "";
  const lockedOfferLine = ad.locked_offer_line?.trim() ?? "";
  const lockedTermsLine = ad.locked_terms_line?.trim() ?? termsSummary;
  const offerDetails = [lockedOfferLine, lockedTermsLine].filter(Boolean).join("\n");
  const displayAd = normalizeGeneratedAdDisplayCopy(ad);
  return {
    title: displayAd.headline,
    promo_line: shortDescription,
    cta_text: ad.cta.trim(),
    offer_details: offerDetails || hint || [shortDescription, ad.cta].filter(Boolean).join("\n\n"),
  };
}

function fallbackClip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max + 1);
  const lastSpace = clipped.search(/\s+\S*$/);
  if (lastSpace > Math.max(16, Math.floor(max * 0.65))) {
    return clipped.slice(0, lastSpace).trimEnd();
  }
  return clean.slice(0, max).trimEnd();
}

export function buildFallbackTemplateAd(params: {
  businessName?: string | null;
  title?: string | null;
  promoLine?: string | null;
  ctaText?: string | null;
  description?: string | null;
  ownerOfferHint?: string | null;
  lockedOfferLine?: string | null;
  lockedTermsLine?: string | null;
  scheduleSummary?: string | null;
  quantityLimit?: number | null;
}): GeneratedAd {
  const lockedOffer = params.lockedOfferLine?.trim() ?? "";
  const existingTitle = params.title?.trim() ?? "";
  const existingPromo = params.promoLine?.trim() ?? "";
  const existingDescription = params.description?.trim() ?? "";
  const ownerHint = params.ownerOfferHint?.trim() ?? "";
  const offerLine = lockedOffer || existingPromo || ownerHint || existingDescription || "Fresh local offer";
  const schedule = params.scheduleSummary?.trim() ?? "";
  const quantity =
    params.quantityLimit && Number.isFinite(params.quantityLimit) && params.quantityLimit > 0
      ? `${params.quantityLimit} available`
      : "";
  const terms = [params.lockedTermsLine?.trim(), schedule, quantity].filter(Boolean).join(" ");
  const fallbackTitle = getDealDisplayTitle({ title: existingTitle || offerLine }, existingTitle || offerLine);
  const fallbackSubheadline = existingPromo || offerLine;

  return {
    headline: fallbackClip(fallbackTitle, DEAL_COPY_LIMITS.headline),
    subheadline: fallbackClip(fallbackSubheadline, 88),
    short_description: fallbackClip(fallbackSubheadline, 120),
    push_notification: fallbackClip(fallbackTitle, DEAL_COPY_LIMITS.pushBody),
    terms_summary: fallbackClip(terms || offerLine, 180),
    social_caption: fallbackClip(`${offerLine}${schedule ? ` ${schedule}` : ""}`, 180),
    locked_offer_line: lockedOffer || undefined,
    locked_terms_line: params.lockedTermsLine?.trim() || undefined,
    copy_source: "DETERMINISTIC_FALLBACK",
    variant_count: 1,
    selected_variant_index: 0,
    validation_reason_codes: [],
    cta: fallbackClip(params.ctaText?.trim() || "Claim deal", 26),
    poster_storage_path: null,
    item_research: { item_name: "", description: "", is_familiar: false },
    photo_source: "fallback_template",
    photo_treatment: null,
  };
}

export function buildOfferDefinitionFallbackAd(
  definition: OfferDefinitionV1,
  params: {
    ctaText?: string | null;
  } = {},
): GeneratedAd {
  const offerSentence = canonicalOfferSentence(definition);
  const disclosureLine = buildOfferDisclosureLine(definition);
  return buildFallbackTemplateAd({
    businessName: definition.merchantName,
    title: definition.canonicalOfferLine,
    promoLine: offerSentence,
    ctaText: params.ctaText,
    ownerOfferHint: offerSentence,
    lockedOfferLine: definition.canonicalOfferLine,
    lockedTermsLine: disclosureLine,
  });
}
