import { describe, expect, it } from "vitest";

import {
  authorizeGeneratedVisualFallback,
  getEligibleAdMediaAssets,
  rankAdMediaAssets,
  selectAdMediaForConcepts,
} from "./ad-media-selection";
import type { BusinessMediaAssetSummary } from "./business-media-library";

const baseAsset: BusinessMediaAssetSummary = {
  id: "asset-1",
  business_id: "biz-1",
  source_type: "website_import",
  storage_path: "biz-1/latte.jpg",
  owner_approved: true,
  rights_confirmed: true,
  auto_use_eligible: true,
  approval_status: "approved",
  moderation_status: "approved",
  tags: ["latte", "coffee"],
  detected_items: ["latte"],
  quality_score: 0.8,
  crop_suitability_score: 0.8,
  brand_fit_score: 0.8,
};

function asset(overrides: Partial<BusinessMediaAssetSummary>): BusinessMediaAssetSummary {
  return { ...baseAsset, ...overrides };
}

describe("ad media selection", () => {
  it("filters eligibility before ranking", () => {
    const eligible = getEligibleAdMediaAssets(
      [
        baseAsset,
        asset({ id: "other-business", business_id: "biz-2" }),
        asset({ id: "no-rights", rights_confirmed: false }),
        asset({ id: "revoked", source_revoked_at: "2026-06-20T00:00:00Z" }),
        asset({
          id: "unlicensed-stock",
          business_id: null,
          source_type: "twofer_stock",
          commercial_ad_use_allowed: false,
        }),
      ],
      "biz-1",
    );

    expect(eligible.map((candidate) => candidate.id)).toEqual(["asset-1"]);
  });

  it("prioritizes an eligible owner-selected photo", () => {
    const selected = asset({
      id: "owner-selected",
      source_type: "owner_upload",
      storage_path: "biz-1/counter.jpg",
      tags: ["counter"],
      detected_items: ["counter"],
      quality_score: 0.62,
    });
    const exact = asset({ id: "exact-latte", source_type: "website_import" });

    const ranked = rankAdMediaAssets([exact, selected], {
      businessId: "biz-1",
      requiredItem: "latte",
      businessCategory: "cafe",
      selectedMediaAssetId: "owner-selected",
      nowIso: "2026-06-20T00:00:00Z",
    });

    expect(ranked[0].asset.id).toBe("owner-selected");
    expect(ranked[0].reasons).toContain("OWNER_SELECTED");
  });

  it("lets relevant licensed stock beat an irrelevant merchant photo", () => {
    const irrelevantMerchant = asset({
      id: "merchant-interior",
      source_type: "website_import",
      storage_path: "biz-1/interior.jpg",
      tags: ["interior"],
      detected_items: ["counter"],
      quality_score: 0.62,
      crop_suitability_score: 0.62,
      brand_fit_score: 0.7,
    });
    const relevantStock = asset({
      id: "stock-latte",
      business_id: null,
      source_type: "twofer_stock",
      storage_path: "stock/latte.jpg",
      tags: ["latte", "coffee", "cafe"],
      detected_items: ["latte"],
      commercial_ad_use_allowed: true,
      license_provider: "twofer-curated",
      license_asset_id: "latte-001",
      license_version: "2026-06-20",
      quality_score: 0.95,
      crop_suitability_score: 0.92,
      brand_fit_score: 0.65,
    });

    const ranked = rankAdMediaAssets([irrelevantMerchant, relevantStock], {
      businessId: "biz-1",
      requiredItem: "latte",
      businessCategory: "cafe",
      nowIso: "2026-06-20T00:00:00Z",
    });

    expect(ranked[0].asset.id).toBe("stock-latte");
    expect(ranked[0].reasons).toContain("TWOFER_STOCK");
    expect(ranked[0].reasons).toContain("REQUIRED_ITEM_MATCH");
  });

  it("authorizes generated visuals only when the eligible pool is empty", () => {
    expect(authorizeGeneratedVisualFallback([baseAsset])).toEqual({ allowed: false, reason: null });
    expect(authorizeGeneratedVisualFallback([])).toEqual({
      allowed: true,
      reason: "NO_ELIGIBLE_MEDIA",
    });
  });

  it("selects three concepts with different eligible assets when the quality band allows it", () => {
    const result = selectAdMediaForConcepts(
      [
        asset({ id: "latte-hero", tags: ["latte"], quality_score: 0.95 }),
        asset({ id: "latte-alt", tags: ["latte", "coffee"], quality_score: 0.9 }),
        asset({ id: "pastry-alt", tags: ["pastry", "cafe"], detected_items: ["pastry"], quality_score: 0.9 }),
      ],
      {
        businessId: "biz-1",
        requiredItem: "latte",
        rewardItem: "pastry",
        businessCategory: "cafe",
        nowIso: "2026-06-20T00:00:00Z",
      },
    );

    expect(result.generatedVisual).toEqual({ allowed: false, reason: null });
    expect(result.concepts.map((concept) => concept.conceptLabel)).toEqual([
      "recommended",
      "alternative_a",
      "alternative_b",
    ]);
    expect(new Set(result.concepts.map((concept) => concept.asset.id)).size).toBeGreaterThan(1);
  });

  it("reuses the strongest asset with alternate crops instead of choosing weak media", () => {
    const result = selectAdMediaForConcepts(
      [
        asset({ id: "strong-latte", tags: ["latte"], quality_score: 0.95 }),
        asset({
          id: "weak-random",
          storage_path: "biz-1/parking-lot.jpg",
          tags: ["parking lot"],
          detected_items: ["parking lot"],
          quality_score: 0.2,
        }),
      ],
      {
        businessId: "biz-1",
        requiredItem: "latte",
        businessCategory: "cafe",
        nowIso: "2026-06-20T00:00:00Z",
      },
    );

    expect(result.concepts.map((concept) => concept.asset.id)).toEqual([
      "strong-latte",
      "strong-latte",
      "strong-latte",
    ]);
    expect(result.concepts.map((concept) => concept.cropVariant)).toEqual(["balanced", "tight", "wide"]);
  });
});
