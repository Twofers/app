import type { AdPresentationSpec } from "./ad-presentation-spec";
import type { ApprovedAdCopy, ImmutableOfferFacts } from "./ad-render-content";

export type AdPresentationHashInput = {
  presentation: AdPresentationSpec;
  copy: ApprovedAdCopy;
  offerFacts: ImmutableOfferFacts;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.keys(object)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const current = object[key];
        if (current !== undefined) acc[key] = stableValue(current);
        return acc;
      }, {});
  }
  return value;
}

export function stablePresentationJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function hashString(value: string): string {
  let h1 = 0xdeadbeef ^ value.length;
  let h2 = 0x41c6ce57 ^ value.length;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const high = (h2 >>> 0).toString(16).padStart(8, "0");
  const low = (h1 >>> 0).toString(16).padStart(8, "0");
  return `${high}${low}`;
}

export function createAdPresentationHash(input: AdPresentationHashInput): string {
  const payload = {
    imageAssetId: input.presentation.imageAssetId,
    crop: input.presentation.crop ?? null,
    focalPoint: input.presentation.focalPoint ?? null,
    templateId: input.presentation.templateId,
    themeId: input.presentation.themeId,
    showLogo: input.presentation.showLogo,
    showSupportingCopy: input.presentation.showSupportingCopy,
    offerRendererVersion: input.offerFacts.accessibilityOfferDescription ? "twofer-authoritative-offer-en-v1" : "unknown",
    headline: input.copy.headline,
    supportingCopy: input.copy.supportingCopy ?? null,
    ctaLabel: input.copy.ctaLabel,
    primaryOfferLine: input.offerFacts.primaryOfferLine,
    compactOfferLine: input.offerFacts.compactOfferLine,
    termsLine: input.offerFacts.termsLine,
    specVersion: input.presentation.specVersion,
    rendererVersion: input.presentation.rendererVersion,
  };
  if (input.presentation.localeOverrides) {
    Object.assign(payload, { localeOverrides: input.presentation.localeOverrides });
  }
  return `adp_${hashString(stablePresentationJson(payload))}`;
}
