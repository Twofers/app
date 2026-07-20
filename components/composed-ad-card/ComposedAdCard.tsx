import { offerLineDuplicatesHeadline } from "@/lib/ad-render-content";
import { resolveAdThemeTokens } from "@/lib/ad-theme-tokens";

import { buildComposedAdAccessibilityLabel } from "./AdAccessibilityText";
import { LiveDropCardTemplate } from "./templates/LiveDropCardTemplate";
import { LocalDiscoveryTemplate } from "./templates/LocalDiscoveryTemplate";
import { PosterOfferTemplate } from "./templates/PosterOfferTemplate";
import { SplitOfferPanelTemplate } from "./templates/SplitOfferPanelTemplate";
import type { ComposedAdCardProps } from "./types";

export type { ComposedAdCardProps } from "./types";

/** Blank the locked line when it only repeats the headline; LockedOfferLine then renders nothing. */
function dedupeOfferLineAgainstHeadline(props: ComposedAdCardProps): ComposedAdCardProps {
  if (!offerLineDuplicatesHeadline(props.offerFacts.primaryOfferLine, props.copy.headline)) return props;
  return { ...props, offerFacts: { ...props.offerFacts, primaryOfferLine: "" } };
}

function effectiveTemplateId(props: ComposedAdCardProps) {
  if (props.posterSpec?.enabled) return "poster_offer";
  if (props.presentation.templateId === "live_drop_card" && props.liveState.status === "live") {
    return "live_drop_card";
  }
  if (props.presentation.imageSourceType !== "deterministic_fallback") {
    if (props.presentation.templateId === "local_discovery_card") return "local_discovery_card";
  }
  return "split_offer_panel";
}

export function ComposedAdCard(rawProps: ComposedAdCardProps) {
  // Accessibility label is built from the original facts: the screen-reader
  // description should still carry the offer line even when it is visually
  // suppressed as a duplicate of the headline.
  const accessibilityLabel = buildComposedAdAccessibilityLabel(rawProps);
  const props = dedupeOfferLineAgainstHeadline(rawProps);
  const tokens = resolveAdThemeTokens(props.presentation.themeId);
  const templateId = effectiveTemplateId(props);
  const templateProps = { ...props, tokens, accessibilityLabel };

  if (templateId === "live_drop_card") {
    return <LiveDropCardTemplate {...templateProps} />;
  }
  if (templateId === "local_discovery_card") {
    return <LocalDiscoveryTemplate {...templateProps} />;
  }
  if (templateId === "poster_offer") {
    return <PosterOfferTemplate {...templateProps} />;
  }
  return <SplitOfferPanelTemplate {...templateProps} />;
}
