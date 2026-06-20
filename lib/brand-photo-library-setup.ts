import {
  type BusinessMediaApprovalStatus,
  type BusinessMediaModerationStatus,
  type BusinessMediaSourceBadge,
  type BusinessMediaSourceType,
  mediaSourceBadge,
} from "./business-media-library";
import { validateWebsiteImportUrl, type WebsiteImportUrlError } from "./website-import-security";

export const BRAND_PHOTO_LIBRARY_SOURCE_ORDER = [
  "owner_upload",
  "website_import",
  "instagram_import",
  "facebook_import",
] as const satisfies readonly BusinessMediaSourceType[];

export type BrandPhotoLibrarySourceType = (typeof BRAND_PHOTO_LIBRARY_SOURCE_ORDER)[number];

export type BrandPhotoLibraryDraft = {
  websiteUrl: string;
  skipForNow: boolean;
  selectedCandidateIds: string[];
  rightsConfirmed: boolean;
};

export type NormalizedBrandPhotoLibraryDraft = {
  websiteUrl: string;
  skipForNow: boolean;
  selectedCandidateIds: string[];
  rightsConfirmed: boolean;
};

export type BrandPhotoLibraryCandidate = {
  id: string;
  sourceType: BrandPhotoLibrarySourceType;
  uri: string;
  width?: number | null;
  height?: number | null;
  moderationStatus: BusinessMediaModerationStatus;
  duplicateKey?: string | null;
};

export type BrandPhotoLibraryCandidateGroup = {
  sourceType: BrandPhotoLibrarySourceType;
  badge: BusinessMediaSourceBadge;
  candidates: BrandPhotoLibraryCandidate[];
};

export type WebsiteDiscoveryIntent =
  | {
      ok: true;
      shouldStartDiscovery: true;
      url: string;
      origin: string;
      hostname: string;
    }
  | {
      ok: true;
      shouldStartDiscovery: false;
    }
  | {
      ok: false;
      reason: WebsiteImportUrlError;
    };

export type BrandPhotoLibrarySetupValidation =
  | {
      ok: true;
      values: NormalizedBrandPhotoLibraryDraft;
      websiteDiscovery: WebsiteDiscoveryIntent;
      completionMode: "skip" | "complete_without_media" | "start_website_discovery" | "approve_selected_media";
    }
  | {
      ok: false;
      reason: "INVALID_WEBSITE_URL" | "RIGHTS_CONFIRMATION_REQUIRED";
      values: NormalizedBrandPhotoLibraryDraft;
      websiteDiscovery: WebsiteDiscoveryIntent;
    };

export type MediaApprovalDecision = {
  candidateId: string;
  sourceType: BrandPhotoLibrarySourceType;
  sourceBadge: BusinessMediaSourceBadge;
  ownerApproved: boolean;
  rightsConfirmed: boolean;
  approvalStatus: BusinessMediaApprovalStatus;
  autoUseEligible: boolean;
};

export type MediaApprovalDecisionResult =
  | {
      ok: true;
      decisions: MediaApprovalDecision[];
    }
  | {
      ok: false;
      reason: "RIGHTS_CONFIRMATION_REQUIRED" | "UNKNOWN_CANDIDATE";
      unknownCandidateIds?: string[];
    };

function cleanId(value: string): string {
  return value.trim();
}

function uniqueCleanIds(values: string[]): string[] {
  return Array.from(new Set(values.map(cleanId).filter(Boolean)));
}

export function normalizeBrandPhotoLibraryDraft(
  draft: BrandPhotoLibraryDraft,
): NormalizedBrandPhotoLibraryDraft {
  return {
    websiteUrl: draft.websiteUrl.trim(),
    skipForNow: draft.skipForNow === true,
    selectedCandidateIds: uniqueCleanIds(draft.selectedCandidateIds),
    rightsConfirmed: draft.rightsConfirmed === true,
  };
}

export function resolveWebsiteDiscoveryIntent(websiteUrl: string): WebsiteDiscoveryIntent {
  const trimmed = websiteUrl.trim();
  if (!trimmed) return { ok: true, shouldStartDiscovery: false };

  const result = validateWebsiteImportUrl(trimmed);
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    shouldStartDiscovery: true,
    url: result.url,
    origin: result.origin,
    hostname: result.hostname,
  };
}

export function validateBrandPhotoLibrarySetup(
  draft: BrandPhotoLibraryDraft,
): BrandPhotoLibrarySetupValidation {
  const values = normalizeBrandPhotoLibraryDraft(draft);
  const websiteDiscovery = resolveWebsiteDiscoveryIntent(values.websiteUrl);

  if (values.skipForNow) {
    return { ok: true, values, websiteDiscovery, completionMode: "skip" };
  }

  if (!websiteDiscovery.ok) {
    return { ok: false, reason: "INVALID_WEBSITE_URL", values, websiteDiscovery };
  }

  if (values.selectedCandidateIds.length > 0 && !values.rightsConfirmed) {
    return { ok: false, reason: "RIGHTS_CONFIRMATION_REQUIRED", values, websiteDiscovery };
  }

  if (values.selectedCandidateIds.length > 0) {
    return { ok: true, values, websiteDiscovery, completionMode: "approve_selected_media" };
  }

  if (websiteDiscovery.shouldStartDiscovery) {
    return { ok: true, values, websiteDiscovery, completionMode: "start_website_discovery" };
  }

  return { ok: true, values, websiteDiscovery, completionMode: "complete_without_media" };
}

export function groupBrandPhotoLibraryCandidates(
  candidates: BrandPhotoLibraryCandidate[],
): BrandPhotoLibraryCandidateGroup[] {
  return BRAND_PHOTO_LIBRARY_SOURCE_ORDER.map((sourceType) => ({
    sourceType,
    badge: mediaSourceBadge(sourceType),
    candidates: candidates.filter((candidate) => candidate.sourceType === sourceType),
  })).filter((group) => group.candidates.length > 0);
}

export function buildMediaApprovalDecisions(
  candidates: BrandPhotoLibraryCandidate[],
  selectedCandidateIds: string[],
  rightsConfirmed: boolean,
): MediaApprovalDecisionResult {
  const selected = new Set(uniqueCleanIds(selectedCandidateIds));
  if (selected.size > 0 && !rightsConfirmed) {
    return { ok: false, reason: "RIGHTS_CONFIRMATION_REQUIRED" };
  }

  const known = new Set(candidates.map((candidate) => candidate.id));
  const unknownCandidateIds = Array.from(selected).filter((id) => !known.has(id));
  if (unknownCandidateIds.length > 0) {
    return { ok: false, reason: "UNKNOWN_CANDIDATE", unknownCandidateIds };
  }

  return {
    ok: true,
    decisions: candidates.map((candidate) => {
      const ownerApproved = selected.has(candidate.id);
      return {
        candidateId: candidate.id,
        sourceType: candidate.sourceType,
        sourceBadge: mediaSourceBadge(candidate.sourceType),
        ownerApproved,
        rightsConfirmed: ownerApproved && rightsConfirmed,
        approvalStatus: ownerApproved ? "approved" : "rejected",
        autoUseEligible: ownerApproved && rightsConfirmed && candidate.moderationStatus === "approved",
      };
    }),
  };
}
