import type { GeneratedAd } from "./ad-variants";
import { DEAL_COPY_LIMITS } from "./deal-offer-contract";
import type { OfferDefinitionV1 } from "./offer-definition";

export const AD_SPEC_RENDERER_VERSION = "twofer-native-ad-renderer-v1";
export const AD_SPEC_TEMPLATE_VERSION = "twofer-safe-templates-v1";

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
    };
  }
  if (definition.sourceAssetIds.length > 0) {
    return {
      source: "source_asset",
      posterStoragePath: null,
      sourceAssetIds: definition.sourceAssetIds,
      treatment: null,
    };
  }
  return {
    source: "template_fallback",
    posterStoragePath: null,
    sourceAssetIds: [],
    treatment: null,
  };
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
}): AdSpecV1 {
  const { offerDefinition, generatedAd } = params;
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
