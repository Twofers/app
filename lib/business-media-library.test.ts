import { describe, expect, it } from "vitest";

import {
  canMediaAssetBeAutoUsedForBusiness,
  isAutoUseEligibleMediaAsset,
  isLicensedTwoferStockAsset,
  mediaSourceBadge,
  type BusinessMediaAssetSummary,
} from "./business-media-library";

const approvedOwnerAsset: BusinessMediaAssetSummary = {
  id: "asset-1",
  business_id: "biz-1",
  source_type: "website_import",
  storage_path: "biz-1/photo.jpg",
  owner_approved: true,
  rights_confirmed: true,
  auto_use_eligible: true,
  approval_status: "approved",
  moderation_status: "approved",
};

describe("business media library contract", () => {
  it("maps source types to owner-facing badges", () => {
    expect(mediaSourceBadge("owner_upload")).toBe("Your photo");
    expect(mediaSourceBadge("website_import")).toBe("Website");
    expect(mediaSourceBadge("instagram_import")).toBe("Instagram");
    expect(mediaSourceBadge("facebook_import")).toBe("Facebook");
    expect(mediaSourceBadge("prior_approved_creative")).toBe("Previously approved");
    expect(mediaSourceBadge("twofer_stock")).toBe("Twofer stock");
    expect(mediaSourceBadge("generated")).toBe("Generated");
  });

  it("requires approval, rights, moderation, and business ownership before auto-use", () => {
    expect(isAutoUseEligibleMediaAsset(approvedOwnerAsset)).toBe(true);
    expect(canMediaAssetBeAutoUsedForBusiness(approvedOwnerAsset, "biz-1")).toBe(true);
    expect(canMediaAssetBeAutoUsedForBusiness(approvedOwnerAsset, "biz-2")).toBe(false);
    expect(isAutoUseEligibleMediaAsset({ ...approvedOwnerAsset, rights_confirmed: false })).toBe(false);
    expect(isAutoUseEligibleMediaAsset({ ...approvedOwnerAsset, moderation_status: "pending" })).toBe(false);
    expect(isAutoUseEligibleMediaAsset({ ...approvedOwnerAsset, source_revoked_at: "2026-06-20T00:00:00Z" })).toBe(false);
  });

  it("requires commercial-ad license metadata for Twofer stock", () => {
    const stock: BusinessMediaAssetSummary = {
      ...approvedOwnerAsset,
      id: "stock-1",
      business_id: null,
      source_type: "twofer_stock",
      storage_path: "stock/latte.jpg",
      commercial_ad_use_allowed: true,
      license_provider: "twofer-curated",
      license_asset_id: "latte-001",
      license_version: "2026-06-20",
    };

    expect(isLicensedTwoferStockAsset(stock)).toBe(true);
    expect(canMediaAssetBeAutoUsedForBusiness(stock, "biz-1")).toBe(true);
    expect(isLicensedTwoferStockAsset({ ...stock, license_version: "" })).toBe(false);
    expect(isAutoUseEligibleMediaAsset({ ...stock, commercial_ad_use_allowed: false })).toBe(false);
  });
});
