import type { ComposedAdCardProps } from "./types";

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function buildComposedAdAccessibilityLabel(props: Pick<ComposedAdCardProps, "merchant" | "liveState" | "copy" | "offerFacts">): string {
  return [
    clean(props.merchant.name),
    clean(props.liveState.statusLabel),
    clean(props.copy.headline),
    clean(props.offerFacts.accessibilityOfferDescription) || clean(props.offerFacts.primaryOfferLine),
    clean(props.liveState.quantityRemainingLabel),
    clean(props.liveState.timeRemainingLabel),
    clean(props.copy.ctaLabel),
    clean(props.offerFacts.termsLine),
    clean(props.copy.imageAltText),
  ]
    .filter(Boolean)
    .join(". ");
}
