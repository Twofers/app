import {
  canMediaAssetBeAutoUsedForBusiness,
  type BusinessMediaAssetSummary,
  type BusinessMediaSourceType,
} from "./business-media-library";

export type AdMediaSelectionContext = {
  businessId: string;
  requiredItem: string;
  rewardItem?: string | null;
  businessCategory?: string | null;
  selectedMediaAssetId?: string | null;
  nowIso?: string;
};

export type AdMediaSelectionReason =
  | "OWNER_SELECTED"
  | "REQUIRED_ITEM_MATCH"
  | "REWARD_ITEM_MATCH"
  | "CATEGORY_MATCH"
  | "BRAND_OR_INTERIOR_MATCH"
  | "SAME_BUSINESS"
  | "TWOFER_STOCK"
  | "HIGH_QUALITY"
  | "CROP_SAFE"
  | "BRAND_FIT"
  | "RECENTLY_USED"
  | "OVERUSED"
  | "TEXT_OR_LOGO_RISK";

export type RankedAdMediaAsset = {
  asset: BusinessMediaAssetSummary;
  score: number;
  reasons: AdMediaSelectionReason[];
};

export type AdMediaConceptSelection = {
  conceptLabel: "recommended" | "alternative_a" | "alternative_b";
  asset: BusinessMediaAssetSummary;
  score: number;
  reasons: AdMediaSelectionReason[];
  cropVariant: "balanced" | "tight" | "wide";
};

export type GeneratedVisualAuthorization =
  | { allowed: false; reason: null }
  | { allowed: true; reason: "NO_ELIGIBLE_MEDIA" };

export type AdMediaSelectionResult = {
  eligibleAssets: BusinessMediaAssetSummary[];
  rankedAssets: RankedAdMediaAsset[];
  generatedVisual: GeneratedVisualAuthorization;
  concepts: AdMediaConceptSelection[];
};

const BRAND_OR_INTERIOR_TAGS = new Set(["brand", "interior", "counter", "storefront", "lifestyle", "team"]);
const SOURCE_PROVENANCE_BONUS: Record<BusinessMediaSourceType, number> = {
  owner_upload: 0.15,
  website_import: 0.13,
  instagram_import: 0.13,
  facebook_import: 0.13,
  prior_approved_creative: 0.12,
  twofer_stock: 0.05,
  generated: 0,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textParts(asset: BusinessMediaAssetSummary): string[] {
  return [
    ...(asset.tags ?? []),
    ...(asset.detected_items ?? []),
    asset.storage_path,
  ]
    .map(cleanText)
    .filter(Boolean);
}

function hasTextMatch(parts: string[], needle: string): boolean {
  const cleanNeedle = cleanText(needle);
  if (!cleanNeedle) return false;
  return parts.some((part) => part.includes(cleanNeedle) || cleanNeedle.includes(part));
}

function scoreRelevance(
  asset: BusinessMediaAssetSummary,
  context: AdMediaSelectionContext,
  reasons: AdMediaSelectionReason[],
): { required: number; reward: number; category: number } {
  const parts = textParts(asset);
  const requiredMatch = hasTextMatch(parts, context.requiredItem);
  const hasRewardItem = Boolean(cleanText(context.rewardItem ?? ""));
  const rewardMatch = hasRewardItem && hasTextMatch(parts, context.rewardItem ?? "");
  const categoryMatch = hasTextMatch(parts, context.businessCategory ?? "");
  const brandOrInterior = parts.some((part) => BRAND_OR_INTERIOR_TAGS.has(part));

  if (requiredMatch) reasons.push("REQUIRED_ITEM_MATCH");
  if (rewardMatch) reasons.push("REWARD_ITEM_MATCH");
  if (categoryMatch) reasons.push("CATEGORY_MATCH");
  if (brandOrInterior) reasons.push("BRAND_OR_INTERIOR_MATCH");

  return {
    required: requiredMatch ? 1 : categoryMatch || brandOrInterior ? 0.45 : 0.1,
    reward: !hasRewardItem ? 0 : rewardMatch ? 1 : requiredMatch ? 0.45 : categoryMatch ? 0.25 : 0,
    category: categoryMatch || brandOrInterior ? 1 : requiredMatch || rewardMatch ? 0.65 : 0.2,
  };
}

function scoreQuality(asset: BusinessMediaAssetSummary, reasons: AdMediaSelectionReason[]): number {
  const quality = asset.quality_score ?? asset.ad_usefulness_score ?? 0.68;
  const score = clamp01(quality);
  if (score >= 0.8) reasons.push("HIGH_QUALITY");
  return score;
}

function scoreCrop(asset: BusinessMediaAssetSummary, reasons: AdMediaSelectionReason[]): number {
  const score = clamp01(asset.crop_suitability_score ?? 0.72);
  if (score >= 0.8) reasons.push("CROP_SAFE");
  return score;
}

function scoreBrandFit(asset: BusinessMediaAssetSummary, reasons: AdMediaSelectionReason[]): number {
  const score = clamp01(asset.brand_fit_score ?? (asset.source_type === "twofer_stock" ? 0.55 : 0.72));
  if (score >= 0.75) reasons.push("BRAND_FIT");
  return score;
}

function recencyAndOveruseScore(
  asset: BusinessMediaAssetSummary,
  nowIso: string,
  reasons: AdMediaSelectionReason[],
): number {
  let score = 1;
  const usageCount = asset.usage_count ?? 0;
  if (usageCount >= 3) {
    reasons.push("OVERUSED");
    score -= Math.min(0.35, usageCount * 0.05);
  }

  const lastUsedAt = cleanText(asset.last_used_at);
  if (lastUsedAt) {
    const daysSinceUse = (Date.parse(nowIso) - Date.parse(lastUsedAt)) / 86_400_000;
    if (Number.isFinite(daysSinceUse) && daysSinceUse >= 0 && daysSinceUse < 7) {
      reasons.push("RECENTLY_USED");
      score -= 0.25;
    }
  }

  if (asset.contains_text || asset.contains_logo) {
    reasons.push("TEXT_OR_LOGO_RISK");
    score -= 0.15;
  }
  return clamp01(score);
}

export function authorizeGeneratedVisualFallback(
  eligibleAssets: BusinessMediaAssetSummary[],
): GeneratedVisualAuthorization {
  return eligibleAssets.length === 0
    ? { allowed: true, reason: "NO_ELIGIBLE_MEDIA" }
    : { allowed: false, reason: null };
}

export function getEligibleAdMediaAssets(
  assets: BusinessMediaAssetSummary[],
  businessId: string,
): BusinessMediaAssetSummary[] {
  return assets.filter((asset) => canMediaAssetBeAutoUsedForBusiness(asset, businessId));
}

export function rankAdMediaAssets(
  assets: BusinessMediaAssetSummary[],
  context: AdMediaSelectionContext,
): RankedAdMediaAsset[] {
  const nowIso = context.nowIso ?? new Date().toISOString();
  const eligibleAssets = getEligibleAdMediaAssets(assets, context.businessId);

  return eligibleAssets
    .map((asset) => {
      const reasons: AdMediaSelectionReason[] = [];
      const relevance = scoreRelevance(asset, context, reasons);
      const selectedBonus = asset.id === cleanText(context.selectedMediaAssetId) ? 0.35 : 0;
      if (selectedBonus > 0) reasons.push("OWNER_SELECTED");
      const sameBusinessScore = asset.business_id === context.businessId ? 1 : 0.35;
      if (asset.business_id === context.businessId) reasons.push("SAME_BUSINESS");
      if (asset.source_type === "twofer_stock") reasons.push("TWOFER_STOCK");

      const sourceBonus = SOURCE_PROVENANCE_BONUS[asset.source_type] ?? 0;
      const score =
        selectedBonus +
        relevance.required * 0.3 +
        relevance.reward * 0.15 +
        sameBusinessScore * 0.15 +
        scoreQuality(asset, reasons) * 0.15 +
        scoreCrop(asset, reasons) * 0.1 +
        scoreBrandFit(asset, reasons) * 0.1 +
        recencyAndOveruseScore(asset, nowIso, reasons) * 0.05 +
        relevance.category * 0.05 +
        sourceBonus;

      return {
        asset,
        score: clamp01(score),
        reasons,
      };
    })
    .sort((a, b) => {
      const selectedDelta =
        Number(b.reasons.includes("OWNER_SELECTED")) - Number(a.reasons.includes("OWNER_SELECTED"));
      return selectedDelta || b.score - a.score;
    });
}

function chooseConceptAssets(rankedAssets: RankedAdMediaAsset[]): AdMediaConceptSelection[] {
  const [top] = rankedAssets;
  if (!top) return [];

  const concepts: AdMediaConceptSelection[] = [
    {
      conceptLabel: "recommended",
      asset: top.asset,
      score: top.score,
      reasons: top.reasons,
      cropVariant: "balanced",
    },
  ];
  const qualityBandFloor = Math.max(0, top.score - 0.18);
  const alternates = rankedAssets.slice(1).filter((candidate) => candidate.score >= qualityBandFloor);
  const conceptLabels = ["alternative_a", "alternative_b"] as const;
  const cropVariants = ["tight", "wide"] as const;

  for (let index = 0; index < conceptLabels.length; index += 1) {
    const ranked = alternates[index] ?? top;
    concepts.push({
      conceptLabel: conceptLabels[index],
      asset: ranked.asset,
      score: ranked.score,
      reasons: ranked.reasons,
      cropVariant: alternates[index] ? "balanced" : cropVariants[index],
    });
  }
  return concepts;
}

export function selectAdMediaForConcepts(
  assets: BusinessMediaAssetSummary[],
  context: AdMediaSelectionContext,
): AdMediaSelectionResult {
  const eligibleAssets = getEligibleAdMediaAssets(assets, context.businessId);
  const rankedAssets = rankAdMediaAssets(assets, context);
  return {
    eligibleAssets,
    rankedAssets,
    generatedVisual: authorizeGeneratedVisualFallback(eligibleAssets),
    concepts: chooseConceptAssets(rankedAssets),
  };
}
