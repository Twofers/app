export const BUSINESS_MEDIA_SOURCE_TYPES = [
  "owner_upload",
  "website_import",
  "instagram_import",
  "facebook_import",
  "prior_approved_creative",
  "twofer_stock",
  "generated",
] as const;

export type BusinessMediaSourceType = (typeof BUSINESS_MEDIA_SOURCE_TYPES)[number];

export type BusinessMediaApprovalStatus = "pending" | "approved" | "rejected" | "disabled";

export type BusinessMediaModerationStatus = "pending" | "approved" | "rejected" | "failed";

export type BusinessMediaSourceBadge =
  | "Your photo"
  | "Website"
  | "Instagram"
  | "Facebook"
  | "Previously approved"
  | "Twofer stock"
  | "Generated";

export type BusinessMediaAssetSummary = {
  id: string;
  business_id: string | null;
  source_type: BusinessMediaSourceType;
  storage_path: string;
  owner_approved: boolean;
  rights_confirmed: boolean;
  auto_use_eligible: boolean;
  approval_status: BusinessMediaApprovalStatus;
  moderation_status: BusinessMediaModerationStatus;
  source_revoked_at?: string | null;
  commercial_ad_use_allowed?: boolean | null;
  license_provider?: string | null;
  license_asset_id?: string | null;
  license_version?: string | null;
};

export type BusinessBrandProfileSummary = {
  id: string;
  business_id: string;
  website_url?: string | null;
  logo_asset_id?: string | null;
  voice_attributes: string[];
  avoid_phrases: string[];
  preferred_phrases: string[];
  owner_approved_at?: string | null;
};

export type AdGenerationJobStage =
  | "queued"
  | "reading_deal"
  | "finding_photo"
  | "creating_visual"
  | "writing_ad"
  | "building_design"
  | "final_review"
  | "ready"
  | "failed"
  | "canceled";

export type AdGenerationJobStatus = "queued" | "running" | "ready" | "failed" | "canceled";

export type AdCreativeConceptLabel = "recommended" | "alternative_a" | "alternative_b" | "revision";

export function mediaSourceBadge(sourceType: BusinessMediaSourceType): BusinessMediaSourceBadge {
  if (sourceType === "website_import") return "Website";
  if (sourceType === "instagram_import") return "Instagram";
  if (sourceType === "facebook_import") return "Facebook";
  if (sourceType === "prior_approved_creative") return "Previously approved";
  if (sourceType === "twofer_stock") return "Twofer stock";
  if (sourceType === "generated") return "Generated";
  return "Your photo";
}

export function isLicensedTwoferStockAsset(asset: BusinessMediaAssetSummary): boolean {
  return (
    asset.source_type === "twofer_stock" &&
    asset.business_id === null &&
    asset.commercial_ad_use_allowed === true &&
    Boolean(asset.license_provider?.trim()) &&
    Boolean(asset.license_asset_id?.trim()) &&
    Boolean(asset.license_version?.trim())
  );
}

export function isApprovedBusinessMediaAsset(asset: BusinessMediaAssetSummary): boolean {
  if (asset.source_type === "twofer_stock") return isLicensedTwoferStockAsset(asset);
  return Boolean(asset.business_id);
}

export function isAutoUseEligibleMediaAsset(asset: BusinessMediaAssetSummary): boolean {
  return (
    isApprovedBusinessMediaAsset(asset) &&
    asset.auto_use_eligible === true &&
    asset.owner_approved === true &&
    asset.rights_confirmed === true &&
    asset.approval_status === "approved" &&
    asset.moderation_status === "approved" &&
    !asset.source_revoked_at
  );
}

export function canMediaAssetBeAutoUsedForBusiness(
  asset: BusinessMediaAssetSummary,
  businessId: string,
): boolean {
  const cleanBusinessId = businessId.trim();
  if (!cleanBusinessId || !isAutoUseEligibleMediaAsset(asset)) return false;
  if (asset.source_type === "twofer_stock") return true;
  return asset.business_id === cleanBusinessId;
}
