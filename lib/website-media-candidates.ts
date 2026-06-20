export type WebsiteMediaSourceKind =
  | "img"
  | "srcset"
  | "picture_source"
  | "lazy_attribute"
  | "open_graph"
  | "json_ld"
  | "schema_logo"
  | "css_background";

export type WebsiteMediaCandidateInput = {
  id: string;
  url: string;
  sourcePageUrl: string;
  sourceKind: WebsiteMediaSourceKind;
  width?: number | null;
  height?: number | null;
  byteSize?: number | null;
  mimeType?: string | null;
  altText?: string | null;
  sha256?: string | null;
  perceptualHash?: string | null;
  transparentPixelRatio?: number | null;
  textDominanceScore?: number | null;
  blurScore?: number | null;
  compressionScore?: number | null;
  embeddedHost?: string | null;
};

export type WebsiteMediaCandidateClassification = "photo" | "logo";

export type WebsiteMediaRejectReason =
  | "INVALID_URL"
  | "UNSUPPORTED_MIME"
  | "TRACKING_PIXEL"
  | "ICON_OR_SPRITE"
  | "PAYMENT_OR_SOCIAL_LOGO"
  | "MARKETPLACE_OR_REVIEW_WIDGET"
  | "TOO_SMALL_FOR_AD_USE"
  | "DUPLICATE";

export type WebsiteMediaQualityWarning =
  | "SMALL_FOR_AD"
  | "TEXT_HEAVY"
  | "BLURRY"
  | "HEAVILY_COMPRESSED"
  | "TRANSPARENT_UI_ASSET"
  | "BANNER_ASPECT_RATIO";

export type WebsiteMediaCandidateDecision =
  | {
      status: "accepted";
      classification: WebsiteMediaCandidateClassification;
      score: number;
      warnings: WebsiteMediaQualityWarning[];
      candidate: WebsiteMediaCandidateInput & { normalizedUrl: string };
    }
  | {
      status: "rejected";
      reason: WebsiteMediaRejectReason;
      candidate: WebsiteMediaCandidateInput & { normalizedUrl?: string };
    }
  | {
      status: "overflow";
      classification: WebsiteMediaCandidateClassification;
      score: number;
      warnings: WebsiteMediaQualityWarning[];
      candidate: WebsiteMediaCandidateInput & { normalizedUrl: string };
    };

export type WebsiteMediaCandidateFilterOptions = {
  maxCandidatesBeforeFiltering?: number;
  maxUsefulThumbnails?: number;
};

export type WebsiteMediaCandidateFilterResult = {
  acceptedPhotos: WebsiteMediaCandidateDecision[];
  logoCandidates: WebsiteMediaCandidateDecision[];
  rejected: WebsiteMediaCandidateDecision[];
  overflow: WebsiteMediaCandidateDecision[];
  truncatedBeforeFiltering: number;
};

type AcceptedWebsiteMediaCandidateDecision = Extract<WebsiteMediaCandidateDecision, { status: "accepted" }>;

const DEFAULT_MAX_CANDIDATES_BEFORE_FILTERING = 100;
const DEFAULT_MAX_USEFUL_THUMBNAILS = 40;
const MIN_PHOTO_SHORT_SIDE = 320;
const MIN_PHOTO_LONG_SIDE = 640;
const MIN_LOGO_SIDE = 64;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const PAYMENT_OR_SOCIAL_KEYWORDS = [
  "amex",
  "apple-pay",
  "facebook",
  "instagram",
  "mastercard",
  "paypal",
  "social",
  "tiktok",
  "twitter",
  "visa",
  "x-logo",
  "yelp",
  "youtube",
];
const ICON_KEYWORDS = ["apple-touch-icon", "favicon", "icon", "sprite"];
const LOGO_KEYWORDS = ["brandmark", "logo", "wordmark"];
const MARKETPLACE_OR_REVIEW_HOST_KEYWORDS = [
  "doordash",
  "grubhub",
  "opentable",
  "tripadvisor",
  "ubereats",
  "yelp",
];

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeImageUrl(rawUrl: string, sourcePageUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl, sourcePageUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function candidateText(candidate: WebsiteMediaCandidateInput, normalizedUrl?: string): string {
  return [
    cleanText(candidate.altText),
    cleanText(candidate.url),
    cleanText(normalizedUrl),
    cleanText(candidate.embeddedHost),
  ].join(" ");
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function dimensions(candidate: WebsiteMediaCandidateInput): { width: number | null; height: number | null } {
  const width = typeof candidate.width === "number" && Number.isFinite(candidate.width) ? candidate.width : null;
  const height = typeof candidate.height === "number" && Number.isFinite(candidate.height) ? candidate.height : null;
  return { width, height };
}

function isLikelyLogo(candidate: WebsiteMediaCandidateInput, text: string): boolean {
  return candidate.sourceKind === "schema_logo" || includesAny(text, LOGO_KEYWORDS);
}

function isTrackingPixel(candidate: WebsiteMediaCandidateInput, text: string): boolean {
  const { width, height } = dimensions(candidate);
  if (width !== null && height !== null && width <= 2 && height <= 2) return true;
  return text.includes("pixel") && width !== null && height !== null && width <= 10 && height <= 10;
}

function isIconOrSprite(candidate: WebsiteMediaCandidateInput, text: string): boolean {
  if (!includesAny(text, ICON_KEYWORDS)) return false;
  const { width, height } = dimensions(candidate);
  const longestSide = Math.max(width ?? 0, height ?? 0);
  return longestSide === 0 || longestSide <= 256;
}

function isTooSmallForPhoto(candidate: WebsiteMediaCandidateInput): boolean {
  const { width, height } = dimensions(candidate);
  if (width === null || height === null) return false;
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  return shortSide < MIN_PHOTO_SHORT_SIDE || longSide < MIN_PHOTO_LONG_SIDE;
}

function isTooSmallForLogo(candidate: WebsiteMediaCandidateInput): boolean {
  const { width, height } = dimensions(candidate);
  if (width === null || height === null) return false;
  return Math.max(width, height) < MIN_LOGO_SIDE;
}

function duplicateKey(candidate: WebsiteMediaCandidateInput, normalizedUrl: string): string {
  return cleanText(candidate.sha256) || cleanText(candidate.perceptualHash) || normalizedUrl;
}

function qualityWarnings(candidate: WebsiteMediaCandidateInput): WebsiteMediaQualityWarning[] {
  const warnings: WebsiteMediaQualityWarning[] = [];
  const { width, height } = dimensions(candidate);
  if (width !== null && height !== null) {
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);
    if (shortSide < 480 || longSide < 800) warnings.push("SMALL_FOR_AD");
    if (longSide / shortSide > 4) warnings.push("BANNER_ASPECT_RATIO");
  }
  if ((candidate.textDominanceScore ?? 0) >= 0.65) warnings.push("TEXT_HEAVY");
  if ((candidate.blurScore ?? 0) >= 0.7) warnings.push("BLURRY");
  if ((candidate.compressionScore ?? 0) >= 0.75) warnings.push("HEAVILY_COMPRESSED");
  if ((candidate.transparentPixelRatio ?? 0) >= 0.5) warnings.push("TRANSPARENT_UI_ASSET");
  return warnings;
}

function scoreCandidate(
  candidate: WebsiteMediaCandidateInput,
  classification: WebsiteMediaCandidateClassification,
  warnings: WebsiteMediaQualityWarning[],
): number {
  const { width, height } = dimensions(candidate);
  const pixelBonus = width !== null && height !== null && width * height >= 1_000_000 ? 0.15 : 0;
  const sourceBonus = candidate.sourceKind === "open_graph" || candidate.sourceKind === "json_ld" ? 0.08 : 0;
  const logoBonus = classification === "logo" ? 0.05 : 0;
  const warningPenalty = warnings.length * 0.08;
  return Math.max(0, Math.min(1, 0.65 + pixelBonus + sourceBonus + logoBonus - warningPenalty));
}

export function filterWebsiteMediaCandidates(
  candidates: WebsiteMediaCandidateInput[],
  options: WebsiteMediaCandidateFilterOptions = {},
): WebsiteMediaCandidateFilterResult {
  const maxCandidatesBeforeFiltering =
    options.maxCandidatesBeforeFiltering ?? DEFAULT_MAX_CANDIDATES_BEFORE_FILTERING;
  const maxUsefulThumbnails = options.maxUsefulThumbnails ?? DEFAULT_MAX_USEFUL_THUMBNAILS;
  const boundedCandidates = candidates.slice(0, maxCandidatesBeforeFiltering);
  const rejected: WebsiteMediaCandidateDecision[] = [];
  const useful: AcceptedWebsiteMediaCandidateDecision[] = [];
  const seen = new Set<string>();

  for (const candidate of boundedCandidates) {
    const normalizedUrl = normalizeImageUrl(candidate.url, candidate.sourcePageUrl);
    if (!normalizedUrl) {
      rejected.push({ status: "rejected", reason: "INVALID_URL", candidate });
      continue;
    }

    const text = candidateText(candidate, normalizedUrl);
    if (isTrackingPixel(candidate, text)) {
      rejected.push({ status: "rejected", reason: "TRACKING_PIXEL", candidate: { ...candidate, normalizedUrl } });
      continue;
    }
    const mimeType = cleanText(candidate.mimeType);
    if (mimeType && !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      rejected.push({ status: "rejected", reason: "UNSUPPORTED_MIME", candidate: { ...candidate, normalizedUrl } });
      continue;
    }
    if (includesAny(text, MARKETPLACE_OR_REVIEW_HOST_KEYWORDS)) {
      rejected.push({
        status: "rejected",
        reason: "MARKETPLACE_OR_REVIEW_WIDGET",
        candidate: { ...candidate, normalizedUrl },
      });
      continue;
    }
    if (includesAny(text, PAYMENT_OR_SOCIAL_KEYWORDS)) {
      rejected.push({
        status: "rejected",
        reason: "PAYMENT_OR_SOCIAL_LOGO",
        candidate: { ...candidate, normalizedUrl },
      });
      continue;
    }

    const classification: WebsiteMediaCandidateClassification = isLikelyLogo(candidate, text) ? "logo" : "photo";
    if (classification === "logo" && isTooSmallForLogo(candidate)) {
      rejected.push({ status: "rejected", reason: "TOO_SMALL_FOR_AD_USE", candidate: { ...candidate, normalizedUrl } });
      continue;
    }
    if (classification === "photo" && isIconOrSprite(candidate, text)) {
      rejected.push({ status: "rejected", reason: "ICON_OR_SPRITE", candidate: { ...candidate, normalizedUrl } });
      continue;
    }
    if (classification === "photo" && isTooSmallForPhoto(candidate)) {
      rejected.push({ status: "rejected", reason: "TOO_SMALL_FOR_AD_USE", candidate: { ...candidate, normalizedUrl } });
      continue;
    }

    const key = duplicateKey(candidate, normalizedUrl);
    if (seen.has(key)) {
      rejected.push({ status: "rejected", reason: "DUPLICATE", candidate: { ...candidate, normalizedUrl } });
      continue;
    }
    seen.add(key);

    const warnings = qualityWarnings(candidate);
    useful.push({
      status: "accepted",
      classification,
      score: scoreCandidate(candidate, classification, warnings),
      warnings,
      candidate: { ...candidate, normalizedUrl },
    });
  }

  const sortedUseful = useful.sort((a, b) => b.score - a.score);
  const accepted = sortedUseful.slice(0, maxUsefulThumbnails);
  const overflow: WebsiteMediaCandidateDecision[] = sortedUseful.slice(maxUsefulThumbnails).map((decision) => ({
    ...decision,
    status: "overflow" as const,
  }));

  return {
    acceptedPhotos: accepted.filter((decision) => decision.status === "accepted" && decision.classification === "photo"),
    logoCandidates: accepted.filter((decision) => decision.status === "accepted" && decision.classification === "logo"),
    rejected,
    overflow,
    truncatedBeforeFiltering: Math.max(0, candidates.length - boundedCandidates.length),
  };
}
