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
import type { AdImageSelection } from "./merchant-image-selection";
import type { AdLocalizationBundle } from "./ad-localization-schema";
import type { SupportedLocale } from "./supported-locales";
import type { PosterDraftV1 } from "./poster/posterTypes";

export type PhotoTreatment = "touchup" | "cleanbg" | "studiopolish";

export type ItemResearch = {
  item_name: string;
  description: string;
  is_familiar: boolean;
};

export type GeneratedAdCopyAlternative = {
  candidate_id?: string;
  strategy_id?: string;
  strategy_reason?: string;
  variant_index?: number | null;
  headline: string;
  short_description: string;
  push_notification?: string;
  social_caption?: string;
  cta?: string;
  selected?: boolean;
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
  copy_alternatives?: GeneratedAdCopyAlternative[];
  validation_reason_codes?: string[];
  cta: string;
  /** Storage path in deal-photos bucket; null if image production failed. */
  poster_storage_path?: string | null;
  /** Web-research context the AI used to write the copy. Empty when research returned nothing. */
  item_research?: ItemResearch;
  /** How the image was produced. */
  photo_source?: "uploaded_original" | "uploaded_enhanced" | "generated" | "stock" | "copy_only" | "fallback_template";
  /** Which enhancement was applied (only meaningful when photo_source = "uploaded_enhanced"). */
  photo_treatment?: PhotoTreatment | null;
  /** Canonical selected image source, QA decision, and lineage metadata. */
  image_selection?: AdImageSelection | null;
  /** Verified source plus target-language persuasive copy bundle, when multilingual generation is enabled. */
  localization_bundle?: AdLocalizationBundle | null;
  localization_status?: {
    source_locale: SupportedLocale;
    localization_bundle_hash: string;
    deterministic_fallback_locales: SupportedLocale[];
    transcreation_provider: string;
    transcreation_model: string;
    transcreation_skipped_reason?: string | null;
    semantic_qa_provider: string;
    semantic_qa_model: string;
    semantic_qa_skipped_reason?: string | null;
    repair_target_locales: SupportedLocale[];
  } | null;
  /** Optional native-rendered production poster draft. The offer lines remain deterministic. */
  poster?: PosterDraftV1 | null;
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

// Merchant-typed copy carries the gaps editing leaves behind: deleting a word
// from "Save 40% on one THE RECON ROAST espresso." leaves "on one  espresso.",
// which used to publish verbatim because only the ends were trimmed. Collapse
// runs of spaces and tabs, and drop trailing ones at line ends. Newlines are
// left alone — the offer details field is multiline and its line breaks are the
// merchant's own.
function collapseInlineSpaces(value: string): string {
  return value
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/[^\S\r\n]+$/gm, "")
    .trim();
}

/** Single string stored on `deals.description` / templates (consumer sees one block). */
export function composeListingDescription(promo: string, cta: string, offerDetails: string): string {
  return [promo, cta, offerDetails].map(collapseInlineSpaces).filter(Boolean).join("\n\n");
}

export function stripAppRenderedTimingMetadata(value: string): string {
  return value
    .replace(/\s*Offer window:\s*[\s\S]*?(?=(?:\s*Claims close\b|\s*Limit one claim\b|\s*Redeem only\b|\s*Limited to\b|\s*Schedule:|\s*Max claims:|$))/gi, " ")
    .replace(/\s*Schedule:\s*[\s\S]*?(?=(?:\s*Max claims:|\s*Limit one claim\b|\s*Redeem only\b|\s*Limited to\b|\s*Claims close\b|$))/gi, " ")
    .replace(/\s*Claims close\b[^.]*\./gi, " ")
    .replace(/\s*Max claims:\s*\d+\.?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function stripDuplicateLeadingLine(value: string, duplicate: string): string {
  const cleanValue = value.trim();
  const cleanDuplicate = duplicate.trim();
  if (!cleanValue || !cleanDuplicate) return cleanValue;
  const normalizedValue = cleanValue.toLowerCase();
  const normalizedDuplicate = cleanDuplicate.toLowerCase();
  if (!normalizedValue.startsWith(normalizedDuplicate)) return cleanValue;
  return cleanValue
    .slice(cleanDuplicate.length)
    .replace(/^[\s.:-]+/, "")
    .trim();
}

function containsMechanicalOfferLanguage(value: string): boolean {
  return /\bBOGO\b|\bSame[-\s]?Item\b|\b2\s*[- ]?\s*for\s*[- ]?\s*1\b|\btwo\s+for\s+one\b/i.test(value);
}

function normalizeCopyAlternatives(ad: GeneratedAd): GeneratedAdCopyAlternative[] | undefined {
  if (!Array.isArray(ad.copy_alternatives)) return ad.copy_alternatives;
  const out = ad.copy_alternatives
    .filter((option): option is GeneratedAdCopyAlternative =>
      !!option &&
      typeof option === "object" &&
      typeof option.headline === "string" &&
      typeof option.short_description === "string"
    )
    .map((option) => ({
      ...option,
      strategy_id: option.strategy_id?.trim(),
      strategy_reason: option.strategy_reason?.trim(),
      headline: getDealDisplayTitle({ title: option.headline }, option.headline),
      short_description: option.short_description.trim(),
      push_notification: option.push_notification?.trim(),
      social_caption: option.social_caption?.trim(),
      cta: option.cta?.trim(),
    }))
    .slice(0, 5);
  return out.length > 0 ? out : undefined;
}

export function normalizeGeneratedAdDisplayCopy(ad: GeneratedAd): GeneratedAd {
  const headline = getDealDisplayTitle({ title: ad.headline }, ad.headline);
  const push = ad.push_notification?.trim() ?? "";
  return {
    ...ad,
    headline,
    push_notification: push ? (containsMechanicalOfferLanguage(push) ? headline : push) : ad.push_notification,
    copy_alternatives: normalizeCopyAlternatives(ad),
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
  const rawLockedTermsLine = stripAppRenderedTimingMetadata(ad.locked_terms_line?.trim() ?? termsSummary);
  const lockedTermsLine = stripDuplicateLeadingLine(rawLockedTermsLine, lockedOfferLine);
  // F-010: when a persuasive promo line (short_description) is present it already
  // states the offer, so also emitting the canonical offer line here restates the
  // offer a third time (promo + offer line + terms) in the stored description.
  // Drop the offer line in that case — but only when the precise terms line
  // survives to carry the offer facts, so the offer is never stripped to nothing.
  const dropOfferLine = Boolean(shortDescription) && Boolean(lockedTermsLine);
  const offerDetails = [dropOfferLine ? "" : lockedOfferLine, lockedTermsLine]
    .filter(Boolean)
    .join("\n");
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

// --- Revision feedback chips: append-with-dedup + chip->preset mapping -----
//
// Suggestion chips used to overwrite whatever the merchant had already typed
// into the feedback box, silently discarding it. appendRevisionFeedback joins
// the chip's canned text onto the existing text instead, skipping the append
// when the addition is already present (case-insensitive) so tapping the same
// chip twice doesn't duplicate it. Capped at the server's 800-char limit.

// Shared with the chip "selected" highlight in app/create/ai.tsx, so the UI's
// notion of "this chip's text is already in the feedback box" never drifts
// from the dedup rule appendRevisionFeedback actually applies.
export function revisionFeedbackContainsSuggestion(feedback: string, suggestionText: string): boolean {
  return feedback.trim().toLowerCase().includes(suggestionText.trim().toLowerCase());
}

// A hard slice(0, maxLength) can land mid-word (e.g. "...crisp" -> "...cri"),
// which reads as data loss/a typo rather than a length limit engaging. Cut at
// the last word boundary at or before maxLength instead, then drop any
// whitespace/punctuation orphaned right at the new end.
function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength);
  const lastBreak = clipped.search(/\s+\S*$/);
  const cut = lastBreak > 0 ? clipped.slice(0, lastBreak) : clipped;
  return cut.replace(/[\s.,;:!?-]+$/, "");
}

export function appendRevisionFeedback(current: string, addition: string, maxLength = 800): string {
  const trimmedCurrent = current.trim();
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return truncateAtWordBoundary(trimmedCurrent, maxLength);
  if (!trimmedCurrent) return truncateAtWordBoundary(trimmedAddition, maxLength);
  if (revisionFeedbackContainsSuggestion(trimmedCurrent, trimmedAddition)) {
    return truncateAtWordBoundary(trimmedCurrent, maxLength);
  }
  const separator = /[.!?]$/.test(trimmedCurrent) ? " " : ". ";
  return truncateAtWordBoundary(`${trimmedCurrent}${separator}${trimmedAddition}`, maxLength);
}

// Stable machine-readable preset keys the revise edge function's
// imageRevisionInstruction/imageStylePresetFromRevision helpers pattern-match
// on (see supabase/functions/ai-generate-ad-variants/index.ts). Sending the
// key alongside the (possibly localized) feedback text keeps the signal
// working regardless of UI locale. Copy-target chips don't yet have a
// server-side consumer for their preset key; the key is still sent for
// forward-compatibility/telemetry and is harmless (ignored) server-side.
const REVISION_SUGGESTION_PRESET_KEYS: Record<string, string> = {
  top_headline: "revisePresetCopyTopHeadline",
  shorter: "revisePresetCopyShorter",
  warmer: "revisePresetCopyWarmer",
  new_image: "revisePresetTryAnotherImage",
};

export function revisionPresetForSuggestion(suggestionKey: string): string | undefined {
  return REVISION_SUGGESTION_PRESET_KEYS[suggestionKey];
}

// --- Copy-version fingerprint: lets a copy-only revision keep its own
// restorable "earlier version" entry instead of overwriting the prior one --
//
// The image-version id (app/create/ai.tsx: imageVersionId) previously keyed
// only on storagePath|source|treatment|editMode, so a revision that changed
// ONLY the copy (headline/body/etc, same image) collided with the entry it
// replaced and the earlier copy became unrecoverable. Mirrors (does not
// import — lib/ai-revision-change.ts is poster-locked and out of scope for
// this change) the visible-copy fields ai-revision-change.ts's
// summarizeAiRevisionChange already treats as "the copy" for change
// detection, so the two stay conceptually in sync.
function normalizeFingerprintValue(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function copyFingerprint(ad: GeneratedAd): string {
  const posterCopy = ad.poster?.copy;
  return [
    ad.headline,
    ad.short_description,
    ad.subheadline,
    ad.cta,
    ad.push_notification,
    ad.terms_summary,
    posterCopy?.headline,
    posterCopy?.offer_line_1,
    posterCopy?.offer_line_2,
    posterCopy?.subline,
  ]
    .map(normalizeFingerprintValue)
    .join("|");
}

/** Deterministic short hash — only used to keep version ids compact, not for security. */
export function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function copyFingerprintHash(ad: GeneratedAd): string {
  return shortHash(copyFingerprint(ad));
}
