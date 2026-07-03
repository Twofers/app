import type { GeneratedAd } from "./ad-variants";
import { DEAL_COPY_LIMITS } from "./deal-offer-contract";
import type { AdImageSelection } from "./merchant-image-selection";
import type { OfferDefinitionV1 } from "./offer-definition";
import { supportedLocaleOrDefault, type SupportedLocale } from "./supported-locales";
import { parsePosterSpecV1, validatePosterSpecV1 } from "./poster/posterAdSpec";
import { normalizePosterSpecForPublish } from "./poster/posterCopy";
import type { AdCreativeFormat, PosterSpecV1 } from "./poster/posterTypes";

export const AD_SPEC_RENDERER_VERSION = "twofer-native-ad-renderer-v1";
export const AD_SPEC_TEMPLATE_VERSION = "twofer-safe-templates-v1";
export const AD_SPEC_V3_RENDERER_VERSION = "twofer-native-ad-renderer-v3";
export const AD_SPEC_V3_MEDIA_SELECTION_VERSION = "twofer-media-selection-v1";
export const AD_SPEC_V3_COPY_PROMPT_VERSION = "AI_COPY_PROMPT_V5";

export type AdSpecSource = "create_ai" | "create_quick";

export type AdSpecChannel = "feed" | "map" | "detail" | "claim" | "push" | "share";

export type AdSpecTemplateId =
  | "feed-photo-balanced-v1"
  | "map-compact-v1"
  | "detail-hero-v1"
  | "claim-confirmation-v1"
  | "push-copy-v1"
  | "share-static-v1"
  | "emergency-text-v1";

export type AdSpecVisual = {
  source: "poster_storage_path" | "source_asset" | "template_fallback";
  posterStoragePath: string | null;
  sourceAssetIds: string[];
  treatment: GeneratedAd["photo_treatment"] | null;
  imageSelection?: AdImageSelection | null;
};

export type AdSpecChannelSlot = {
  channel: AdSpecChannel;
  templateId: AdSpecTemplateId;
  headline: string;
  supportingLine: string;
  ctaLabel: string;
  canonicalOfferSentence: string;
  disclosureLine: string;
  merchantName: string;
  locationName: string;
  visual: AdSpecVisual;
  accessibility: {
    altText: string;
    criticalTextRenderedNatively: true;
    minimumContrastRatio: 4.5;
  };
};

export type AdSpecV1 = {
  adSpecVersion: 1;
  creative_format: AdCreativeFormat;
  selected_language: SupportedLocale;
  poster?: PosterSpecV1 | null;
  rendererVersion: typeof AD_SPEC_RENDERER_VERSION;
  templateVersion: typeof AD_SPEC_TEMPLATE_VERSION;
  source: AdSpecSource;
  offer: {
    merchantId: string;
    merchantName: string;
    locationId: string;
    locationName: string;
    canonicalOfferSentence: string;
    disclosureLine: string;
    startsAt: string | null;
    endsAt: string | null;
    timeZone: string | null;
    totalClaimLimit: number | null;
  };
  creative: {
    headline: string;
    supportingLine: string;
    ctaLabel: string;
    pushTitle: string;
    pushBody: string;
    socialCaption: string;
    copySource: GeneratedAd["copy_source"] | "DETERMINISTIC_FALLBACK";
  };
  channels: Record<AdSpecChannel, AdSpecChannelSlot>;
  dynamicBindings: {
    remainingClaims: "offer.remainingClaims";
    endsAt: "offer.endsAt";
    locationName: "location.displayName";
    canonicalOfferSentence: "offer.canonicalOfferSentence";
    disclosureLine: "offer.disclosureLine";
  };
  quality: {
    hardGateStatus: "pass";
    reasonCodes: string[];
  };
  rollback: {
    fallbackTemplateId: "emergency-text-v1";
  };
};

export type AdSpecValidationResult = {
  valid: boolean;
  reasonCodes: string[];
};

export type AdSpecV3TextField =
  | "displayHook"
  | "offerLine"
  | "supportingLine"
  | "cta"
  | "pushTitle"
  | "pushBody"
  | "socialCaption";

export type AdSpecV3TextProvenance =
  | "ai_generated"
  | "deterministic"
  | "merchant_typed"
  | "merchant_edited";

export type AdSpecV3MediaSourceType =
  | "owner_upload"
  | "website_import"
  | "instagram_import"
  | "facebook_import"
  | "prior_approved_creative"
  | "twofer_stock"
  | "generated";

export type AdSpecV3CropSpec = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AdSpecV3Visual = {
  mediaAssetId: string | null;
  posterStoragePath: string | null;
  sourceType: AdSpecV3MediaSourceType;
  sourceBadge:
    | "Your photo"
    | "Website"
    | "Instagram"
    | "Facebook"
    | "Previously approved"
    | "Twofer stock"
    | "Generated";
  crop: AdSpecV3CropSpec | null;
  treatment: GeneratedAd["photo_treatment"] | null;
  templateId: "feed-photo-balanced-v3";
  generationAuthorizedReason: "NO_ELIGIBLE_MEDIA" | null;
};

export type AdSpecV3 = {
  version: "3";
  creative_format: AdCreativeFormat;
  selected_language: SupportedLocale;
  poster?: PosterSpecV1 | null;
  source: AdSpecSource;
  offerDefinitionVersion: 1;
  offerDefinitionId: string;
  businessId: string;
  creative: Record<AdSpecV3TextField, string>;
  terms: {
    lockedOfferLine: string;
    summary: string;
    scheduleSummary: string | null;
    scarcitySummary: string | null;
  };
  textProvenance: Record<AdSpecV3TextField, AdSpecV3TextProvenance>;
  visual: AdSpecV3Visual;
  quality: {
    factual: number;
    clarity: number;
    naturalness: number;
    brandFit: number;
    visualRelevance: number;
    overall: number;
    reasonCodes: string[];
  };
  provenance: {
    copyModel: string | null;
    copyPromptVersion: typeof AD_SPEC_V3_COPY_PROMPT_VERSION;
    imageModel: string | null;
    mediaSelectionVersion: typeof AD_SPEC_V3_MEDIA_SELECTION_VERSION;
    rendererVersion: typeof AD_SPEC_V3_RENDERER_VERSION;
    copySource: GeneratedAd["copy_source"] | "DETERMINISTIC_FALLBACK";
  };
};

export type BuildAdSpecV3Params = {
  source: AdSpecSource;
  offerDefinition: OfferDefinitionV1;
  generatedAd?: GeneratedAd | null;
  visual: {
    mediaAssetId?: string | null;
    posterStoragePath?: string | null;
    sourceType: AdSpecV3MediaSourceType;
    crop?: AdSpecV3CropSpec | null;
    generationAuthorizedReason?: "NO_ELIGIBLE_MEDIA" | null;
  };
  copyModel?: string | null;
  imageModel?: string | null;
  textProvenanceOverrides?: Partial<Record<AdSpecV3TextField, AdSpecV3TextProvenance>>;
};

const CHANNELS: AdSpecChannel[] = ["feed", "map", "detail", "claim", "push", "share"];

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function firstText(values: unknown[], fallback: string): string {
  for (const value of values) {
    const clean = cleanText(value);
    if (clean) return clean;
  }
  return fallback;
}

function clip(value: string, max: number): string {
  const clean = cleanText(value);
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max + 1);
  const lastSpace = clipped.search(/\s+\S*$/);
  if (lastSpace > Math.max(16, Math.floor(max * 0.65))) {
    return clipped.slice(0, lastSpace).trimEnd();
  }
  return clean.slice(0, max).trimEnd();
}

function boundedScore(value: unknown, fallback = 1): number {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function offerDefinitionStableId(definition: OfferDefinitionV1): string {
  return [
    definition.merchantId,
    definition.locationId,
    definition.offerType,
    definition.canonicalOfferLine,
  ].join(":");
}

function sourceBadgeFor(sourceType: AdSpecV3MediaSourceType): AdSpecV3Visual["sourceBadge"] {
  if (sourceType === "website_import") return "Website";
  if (sourceType === "instagram_import") return "Instagram";
  if (sourceType === "facebook_import") return "Facebook";
  if (sourceType === "prior_approved_creative") return "Previously approved";
  if (sourceType === "twofer_stock") return "Twofer stock";
  if (sourceType === "generated") return "Generated";
  return "Your photo";
}

function generatedAdCopyProvenance(generatedAd?: GeneratedAd | null): AdSpecV3TextProvenance {
  if (!generatedAd) return "deterministic";
  return generatedAd.copy_source === "DETERMINISTIC_FALLBACK" ? "deterministic" : "ai_generated";
}

function completeTextProvenance(
  base: AdSpecV3TextProvenance,
  overrides?: Partial<Record<AdSpecV3TextField, AdSpecV3TextProvenance>>,
): Record<AdSpecV3TextField, AdSpecV3TextProvenance> {
  return {
    displayHook: overrides?.displayHook ?? base,
    offerLine: overrides?.offerLine ?? "deterministic",
    supportingLine: overrides?.supportingLine ?? base,
    cta: overrides?.cta ?? base,
    pushTitle: overrides?.pushTitle ?? base,
    pushBody: overrides?.pushBody ?? base,
    socialCaption: overrides?.socialCaption ?? base,
  };
}

function templateFor(channel: AdSpecChannel, visual: AdSpecVisual): AdSpecTemplateId {
  if (visual.source === "template_fallback" && channel !== "push") return "emergency-text-v1";
  if (channel === "feed") return "feed-photo-balanced-v1";
  if (channel === "map") return "map-compact-v1";
  if (channel === "detail") return "detail-hero-v1";
  if (channel === "claim") return "claim-confirmation-v1";
  if (channel === "push") return "push-copy-v1";
  return "share-static-v1";
}

function visualFor(definition: OfferDefinitionV1, generatedAd?: GeneratedAd | null): AdSpecVisual {
  const posterStoragePath = cleanText(generatedAd?.poster_storage_path) || null;
  if (posterStoragePath) {
    return {
      source: "poster_storage_path",
      posterStoragePath,
      sourceAssetIds: definition.sourceAssetIds,
      treatment: generatedAd?.photo_treatment ?? null,
      imageSelection: generatedAd?.image_selection ?? null,
    };
  }
  if (definition.sourceAssetIds.length > 0) {
    return {
      source: "source_asset",
      posterStoragePath: null,
      sourceAssetIds: definition.sourceAssetIds,
      treatment: null,
      imageSelection: generatedAd?.image_selection ?? null,
    };
  }
  return {
    source: "template_fallback",
    posterStoragePath: null,
    sourceAssetIds: [],
    treatment: null,
    imageSelection: generatedAd?.image_selection ?? null,
  };
}

function posterSpecForAd(generatedAd?: GeneratedAd | null): PosterSpecV1 | null {
  if (!generatedAd?.poster?.enabled) return null;
  const parsed = parsePosterSpecV1(generatedAd.poster);
  return parsed ? normalizePosterSpecForPublish(parsed) : null;
}

function buildSlot(params: {
  channel: AdSpecChannel;
  definition: OfferDefinitionV1;
  visual: AdSpecVisual;
  headline: string;
  supportingLine: string;
  ctaLabel: string;
}): AdSpecChannelSlot {
  const altText =
    params.visual.source === "template_fallback"
      ? `${params.definition.merchantName} offer card for ${params.definition.canonicalOfferSentence}`
      : `${params.definition.merchantName} offer image. ${params.definition.canonicalOfferSentence}`;
  return {
    channel: params.channel,
    templateId: templateFor(params.channel, params.visual),
    headline: params.channel === "push" ? clip(params.headline, DEAL_COPY_LIMITS.pushTitle) : params.headline,
    supportingLine:
      params.channel === "push"
        ? clip(params.supportingLine, DEAL_COPY_LIMITS.pushBody)
        : params.supportingLine,
    ctaLabel: params.ctaLabel,
    canonicalOfferSentence: params.definition.canonicalOfferSentence,
    disclosureLine: params.definition.disclosureLine,
    merchantName: params.definition.merchantName,
    locationName: params.definition.locationName,
    visual: params.visual,
    accessibility: {
      altText: clip(altText, 180),
      criticalTextRenderedNatively: true,
      minimumContrastRatio: 4.5,
    },
  };
}

export function buildAdSpecV1(params: {
  source: AdSpecSource;
  offerDefinition: OfferDefinitionV1;
  generatedAd?: GeneratedAd | null;
  selectedLanguage?: SupportedLocale | string | null;
}): AdSpecV1 {
  const { offerDefinition, generatedAd } = params;
  const poster = posterSpecForAd(generatedAd);
  const visual = visualFor(offerDefinition, generatedAd);
  const headline = clip(
    firstText([generatedAd?.headline, offerDefinition.canonicalOfferLine], offerDefinition.canonicalOfferSentence),
    DEAL_COPY_LIMITS.headline,
  );
  const supportingLine = clip(
    firstText(
      [generatedAd?.short_description, generatedAd?.subheadline, offerDefinition.canonicalOfferSentence],
      offerDefinition.canonicalOfferSentence,
    ),
    DEAL_COPY_LIMITS.description,
  );
  const ctaLabel = clip(firstText([generatedAd?.cta], "Claim deal"), 26);
  const pushBody = clip(
    firstText([generatedAd?.push_notification, supportingLine], supportingLine),
    DEAL_COPY_LIMITS.pushBody,
  );
  const socialCaption = clip(
    firstText([generatedAd?.social_caption, supportingLine], supportingLine),
    DEAL_COPY_LIMITS.socialCaption,
  );

  const slotParams = {
    definition: offerDefinition,
    visual,
    headline,
    supportingLine,
    ctaLabel,
  };
  const channels = Object.fromEntries(
    CHANNELS.map((channel) => [channel, buildSlot({ ...slotParams, channel })]),
  ) as Record<AdSpecChannel, AdSpecChannelSlot>;

  return {
    adSpecVersion: 1,
    creative_format: poster ? "poster_v1" : "standard_card",
    selected_language: supportedLocaleOrDefault(params.selectedLanguage ?? "en-US"),
    ...(poster ? { poster } : {}),
    rendererVersion: AD_SPEC_RENDERER_VERSION,
    templateVersion: AD_SPEC_TEMPLATE_VERSION,
    source: params.source,
    offer: {
      merchantId: offerDefinition.merchantId,
      merchantName: offerDefinition.merchantName,
      locationId: offerDefinition.locationId,
      locationName: offerDefinition.locationName,
      canonicalOfferSentence: offerDefinition.canonicalOfferSentence,
      disclosureLine: offerDefinition.disclosureLine,
      startsAt: offerDefinition.schedule.startsAt,
      endsAt: offerDefinition.schedule.endsAt,
      timeZone: offerDefinition.timeZone,
      totalClaimLimit: offerDefinition.totalClaimLimit,
    },
    creative: {
      headline,
      supportingLine,
      ctaLabel,
      pushTitle: clip(headline, DEAL_COPY_LIMITS.pushTitle),
      pushBody,
      socialCaption,
      copySource: generatedAd?.copy_source ?? "DETERMINISTIC_FALLBACK",
    },
    channels,
    dynamicBindings: {
      remainingClaims: "offer.remainingClaims",
      endsAt: "offer.endsAt",
      locationName: "location.displayName",
      canonicalOfferSentence: "offer.canonicalOfferSentence",
      disclosureLine: "offer.disclosureLine",
    },
    quality: {
      hardGateStatus: "pass",
      reasonCodes: [],
    },
    rollback: {
      fallbackTemplateId: "emergency-text-v1",
    },
  };
}

export function validateAdSpecV1(value: unknown): AdSpecValidationResult {
  const reasonCodes: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reasonCodes: ["NOT_OBJECT"] };
  }
  const spec = value as Partial<AdSpecV1>;
  if (spec.adSpecVersion !== 1) reasonCodes.push("INVALID_SCHEMA_VERSION");
  const creativeFormat = spec.creative_format ?? "standard_card";
  if (creativeFormat !== "standard_card" && creativeFormat !== "poster_v1") reasonCodes.push("INVALID_CREATIVE_FORMAT");
  if (creativeFormat === "poster_v1") {
    const posterValidation = validatePosterSpecV1(spec.poster);
    if (!posterValidation.valid) reasonCodes.push(...posterValidation.reasonCodes);
  }
  if (spec.rendererVersion !== AD_SPEC_RENDERER_VERSION) reasonCodes.push("INVALID_RENDERER_VERSION");
  if (spec.templateVersion !== AD_SPEC_TEMPLATE_VERSION) reasonCodes.push("INVALID_TEMPLATE_VERSION");
  if (!spec.offer || !cleanText(spec.offer.canonicalOfferSentence)) reasonCodes.push("MISSING_CANONICAL_OFFER");
  if (!spec.offer || !cleanText(spec.offer.disclosureLine)) reasonCodes.push("MISSING_DISCLOSURE");
  if (!spec.creative || !cleanText(spec.creative.headline)) reasonCodes.push("MISSING_HEADLINE");
  if (!spec.channels || typeof spec.channels !== "object") {
    reasonCodes.push("MISSING_CHANNELS");
  } else {
    for (const channel of CHANNELS) {
      const slot = spec.channels[channel];
      if (!slot) {
        reasonCodes.push(`MISSING_${channel.toUpperCase()}_CHANNEL`);
        continue;
      }
      if (slot.canonicalOfferSentence !== spec.offer?.canonicalOfferSentence) {
        reasonCodes.push(`FACT_MISMATCH_${channel.toUpperCase()}`);
      }
      if (slot.accessibility?.criticalTextRenderedNatively !== true) {
        reasonCodes.push(`CRITICAL_TEXT_NOT_NATIVE_${channel.toUpperCase()}`);
      }
    }
  }
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

export function buildAdSpecV3(params: BuildAdSpecV3Params): AdSpecV3 {
  const { offerDefinition, generatedAd } = params;
  const poster = posterSpecForAd(generatedAd);
  const baseProvenance = generatedAdCopyProvenance(generatedAd);
  const displayHook = clip(
    firstText([generatedAd?.headline, offerDefinition.canonicalOfferLine], offerDefinition.canonicalOfferLine),
    DEAL_COPY_LIMITS.headline,
  );
  const supportingLine = clip(
    firstText(
      [generatedAd?.short_description, generatedAd?.subheadline, offerDefinition.canonicalOfferSentence],
      offerDefinition.canonicalOfferSentence,
    ),
    DEAL_COPY_LIMITS.description,
  );
  const pushBody = clip(
    firstText([generatedAd?.push_notification, supportingLine], supportingLine),
    DEAL_COPY_LIMITS.pushBody,
  );
  const socialCaption = clip(
    firstText([generatedAd?.social_caption, supportingLine], supportingLine),
    DEAL_COPY_LIMITS.socialCaption,
  );
  const posterStoragePath =
    cleanText(params.visual.posterStoragePath) || cleanText(generatedAd?.poster_storage_path) || null;
  const visualRelevance = params.visual.sourceType === "generated" ? 0.7 : 1;

  return {
    version: "3",
    creative_format: poster ? "poster_v1" : "standard_card",
    selected_language: supportedLocaleOrDefault(generatedAd?.localization_bundle?.sourceLocale ?? "en-US"),
    ...(poster ? { poster } : {}),
    source: params.source,
    offerDefinitionVersion: 1,
    offerDefinitionId: offerDefinitionStableId(offerDefinition),
    businessId: offerDefinition.merchantId,
    creative: {
      displayHook,
      offerLine: offerDefinition.canonicalOfferLine,
      supportingLine,
      cta: clip(firstText([generatedAd?.cta], "Claim deal"), 26),
      pushTitle: clip(displayHook, DEAL_COPY_LIMITS.pushTitle),
      pushBody,
      socialCaption,
    },
    terms: {
      lockedOfferLine: offerDefinition.canonicalOfferLine,
      summary: offerDefinition.disclosureLine,
      scheduleSummary: offerDefinition.schedule.summary,
      scarcitySummary:
        offerDefinition.totalClaimLimit == null ? null : `${offerDefinition.totalClaimLimit} available`,
    },
    textProvenance: completeTextProvenance(baseProvenance, params.textProvenanceOverrides),
    visual: {
      mediaAssetId: cleanText(params.visual.mediaAssetId) || null,
      posterStoragePath,
      sourceType: params.visual.sourceType,
      sourceBadge: sourceBadgeFor(params.visual.sourceType),
      crop: params.visual.crop ?? null,
      treatment: generatedAd?.photo_treatment ?? null,
      templateId: "feed-photo-balanced-v3",
      generationAuthorizedReason: params.visual.generationAuthorizedReason ?? null,
    },
    quality: {
      factual: 1,
      clarity: 1,
      naturalness: 1,
      brandFit: 1,
      visualRelevance,
      overall: boundedScore(visualRelevance),
      reasonCodes: generatedAd?.validation_reason_codes ?? [],
    },
    provenance: {
      copyModel: cleanText(params.copyModel) || null,
      copyPromptVersion: AD_SPEC_V3_COPY_PROMPT_VERSION,
      imageModel: cleanText(params.imageModel) || null,
      mediaSelectionVersion: AD_SPEC_V3_MEDIA_SELECTION_VERSION,
      rendererVersion: AD_SPEC_V3_RENDERER_VERSION,
      copySource: generatedAd?.copy_source ?? "DETERMINISTIC_FALLBACK",
    },
  };
}

export function validateAdSpecV3(value: unknown): AdSpecValidationResult {
  const reasonCodes: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reasonCodes: ["NOT_OBJECT"] };
  }
  const spec = value as Partial<AdSpecV3>;
  if (spec.version !== "3") reasonCodes.push("INVALID_SCHEMA_VERSION");
  const creativeFormat = spec.creative_format ?? "standard_card";
  if (creativeFormat !== "standard_card" && creativeFormat !== "poster_v1") reasonCodes.push("INVALID_CREATIVE_FORMAT");
  if (creativeFormat === "poster_v1") {
    const posterValidation = validatePosterSpecV1(spec.poster);
    if (!posterValidation.valid) reasonCodes.push(...posterValidation.reasonCodes);
  }
  if (!cleanText(spec.businessId)) reasonCodes.push("MISSING_BUSINESS_ID");
  if (!cleanText(spec.offerDefinitionId)) reasonCodes.push("MISSING_OFFER_DEFINITION_ID");
  if (!spec.creative || typeof spec.creative !== "object") {
    reasonCodes.push("MISSING_CREATIVE");
  } else {
    for (const field of [
      "displayHook",
      "offerLine",
      "supportingLine",
      "cta",
      "pushTitle",
      "pushBody",
      "socialCaption",
    ] as const) {
      if (!cleanText(spec.creative[field])) reasonCodes.push(`MISSING_${field.toUpperCase()}`);
    }
  }
  if (!spec.terms || typeof spec.terms !== "object") {
    reasonCodes.push("MISSING_TERMS");
  } else {
    if (!cleanText(spec.terms.lockedOfferLine)) reasonCodes.push("MISSING_LOCKED_OFFER_LINE");
    if (!cleanText(spec.terms.summary)) reasonCodes.push("MISSING_TERMS_SUMMARY");
    if (spec.creative?.offerLine !== spec.terms.lockedOfferLine) {
      reasonCodes.push("OFFER_LINE_NOT_LOCKED");
    }
  }
  if (!spec.textProvenance || typeof spec.textProvenance !== "object") {
    reasonCodes.push("MISSING_TEXT_PROVENANCE");
  } else {
    for (const field of [
      "displayHook",
      "offerLine",
      "supportingLine",
      "cta",
      "pushTitle",
      "pushBody",
      "socialCaption",
    ] as const) {
      if (!spec.textProvenance[field]) reasonCodes.push(`MISSING_${field.toUpperCase()}_PROVENANCE`);
    }
  }
  if (!spec.visual || typeof spec.visual !== "object") {
    reasonCodes.push("MISSING_VISUAL");
  } else {
    const hasVisualAsset = Boolean(cleanText(spec.visual.mediaAssetId) || cleanText(spec.visual.posterStoragePath));
    if (!hasVisualAsset) reasonCodes.push("MISSING_VISUAL_ASSET");
    if (
      spec.visual.sourceType === "generated" &&
      spec.visual.generationAuthorizedReason !== "NO_ELIGIBLE_MEDIA"
    ) {
      reasonCodes.push("GENERATED_WITHOUT_EMPTY_POOL_AUTHORIZATION");
    }
  }
  if (!spec.provenance || typeof spec.provenance !== "object") {
    reasonCodes.push("MISSING_PROVENANCE");
  } else {
    if (spec.provenance.copyPromptVersion !== AD_SPEC_V3_COPY_PROMPT_VERSION) {
      reasonCodes.push("INVALID_COPY_PROMPT_VERSION");
    }
    if (spec.provenance.mediaSelectionVersion !== AD_SPEC_V3_MEDIA_SELECTION_VERSION) {
      reasonCodes.push("INVALID_MEDIA_SELECTION_VERSION");
    }
    if (spec.provenance.rendererVersion !== AD_SPEC_V3_RENDERER_VERSION) {
      reasonCodes.push("INVALID_RENDERER_VERSION");
    }
  }
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}
