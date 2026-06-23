import type { DealOfferContract } from "./deal-offer-contract.ts";
import {
  getDealDisplayDescription,
  getDealDisplayTitle,
  type DealDisplayTitleFields,
} from "./deal-display-copy.ts";
import type { OfferDefinitionV1 } from "./offer-definition.ts";

export type LockedOfferContent = {
  primaryOfferLine: string;
  compactOfferLine: string;
  termsLine: string;
  accessibilityOfferDescription: string;
};

export const AUTHORITATIVE_OFFER_RENDERER_VERSION = "twofer-authoritative-offer-en-v1";

const FALLBACK_OFFER_LINE = "Limited-time local offer";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function sentence(value: string): string {
  const clean = cleanText(value);
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

export function containsBannedOfferShorthand(value: string | null | undefined): boolean {
  const clean = cleanText(value);
  return /\bBOGO\b|\b2\s*[- ]?\s*for\s*[- ]?\s*1\b|\b2\s*x\s*1\b|\b1\s*\+\s*1\b|\btwo\s+for\s+one\b/i.test(clean);
}

function safeOfferLine(primary: string, fallback?: string | null): string {
  const first = cleanText(primary);
  if (first && !containsBannedOfferShorthand(first)) return first;
  const second = cleanText(fallback);
  if (second && !containsBannedOfferShorthand(second)) return second;
  return FALLBACK_OFFER_LINE;
}

export function buildLockedOfferContent(params: {
  primaryOfferLine?: string | null;
  termsLine?: string | null;
  fallbackOfferLine?: string | null;
}): LockedOfferContent {
  const primaryOfferLine = safeOfferLine(params.primaryOfferLine ?? "", params.fallbackOfferLine);
  const termsLine = cleanText(params.termsLine);
  const accessibilityOfferDescription = [sentence(primaryOfferLine), termsLine].filter(Boolean).join(" ");

  return {
    primaryOfferLine,
    compactOfferLine: primaryOfferLine,
    termsLine,
    accessibilityOfferDescription: accessibilityOfferDescription || primaryOfferLine,
  };
}

export function renderAuthoritativeOfferFromContract(contract: DealOfferContract): LockedOfferContent {
  return buildLockedOfferContent({
    primaryOfferLine: contract.canonicalOfferLine,
    termsLine: contract.canonicalShortTerms,
  });
}

export function renderAuthoritativeOfferFromDefinition(definition: OfferDefinitionV1): LockedOfferContent {
  return buildLockedOfferContent({
    primaryOfferLine: definition.canonicalOfferLine,
    termsLine: definition.disclosureLine || definition.canonicalTermsLine,
    fallbackOfferLine: definition.canonicalOfferSentence,
  });
}

function withoutLockedFields(deal: DealDisplayTitleFields): DealDisplayTitleFields {
  const {
    locked_offer_line: _lockedOfferLine,
    lockedOfferLine: _lockedOfferLineCamel,
    locked_terms_line: _lockedTermsLine,
    lockedTermsLine: _lockedTermsLineCamel,
    canonical_offer_sentence: _canonicalOfferSentence,
    canonicalOfferSentence: _canonicalOfferSentenceCamel,
    disclosure_line: _disclosureLine,
    disclosureLine: _disclosureLineCamel,
    ad_spec: _adSpec,
    adSpec: _adSpecCamel,
    offer_version: _offerVersion,
    offer_versions: _offerVersions,
    ...rest
  } = deal;
  return rest;
}

export function renderAuthoritativeOfferFromDeal(
  deal: DealDisplayTitleFields | null | undefined,
  fallback?: {
    title?: string | null;
    description?: string | null;
  },
): LockedOfferContent {
  const source = deal ?? {};
  const fallbackTitle = cleanText(fallback?.title);
  const title = getDealDisplayTitle(source, fallbackTitle);
  const structuredFallback = containsBannedOfferShorthand(title)
    ? getDealDisplayTitle(withoutLockedFields(source), fallbackTitle)
    : title;
  const description = getDealDisplayDescription(source, fallback?.description, fallbackTitle);

  return buildLockedOfferContent({
    primaryOfferLine: title,
    fallbackOfferLine: structuredFallback,
    termsLine: description,
  });
}
