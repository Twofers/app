import type { ComposedAdCardProps } from "./types";

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function sentencePart(value: string | null | undefined): string {
  return clean(value).replace(/[.!?]+$/g, "");
}

export function buildComposedAdAccessibilityLabel(props: Pick<ComposedAdCardProps, "merchant" | "liveState" | "copy" | "offerFacts">): string {
  return [
    sentencePart(props.merchant.name),
    sentencePart(props.liveState.statusLabel),
    sentencePart(props.copy.headline),
    sentencePart(props.offerFacts.accessibilityOfferDescription) || sentencePart(props.offerFacts.primaryOfferLine),
    sentencePart(props.liveState.quantityRemainingLabel),
    sentencePart(props.liveState.timeRemainingLabel),
    sentencePart(props.copy.ctaLabel),
    sentencePart(props.offerFacts.termsLine),
    sentencePart(props.copy.imageAltText),
  ]
    .filter(Boolean)
    .join(". ");
}
