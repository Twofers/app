import { resolveAdThemeTokens } from "@/lib/ad-theme-tokens";

import { buildComposedAdAccessibilityLabel } from "./AdAccessibilityText";
import { LiveDropCardTemplate } from "./templates/LiveDropCardTemplate";
import { LocalDiscoveryTemplate } from "./templates/LocalDiscoveryTemplate";
import { PosterOfferTemplate } from "./templates/PosterOfferTemplate";
import { SplitOfferPanelTemplate } from "./templates/SplitOfferPanelTemplate";
import type { ComposedAdCardProps } from "./types";

export type { ComposedAdCardProps } from "./types";

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

export function ComposedAdCard(props: ComposedAdCardProps) {
  const tokens = resolveAdThemeTokens(props.presentation.themeId);
  const accessibilityLabel = buildComposedAdAccessibilityLabel(props);
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
