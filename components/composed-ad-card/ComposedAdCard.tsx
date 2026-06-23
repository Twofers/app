import { resolveAdThemeTokens } from "@/lib/ad-theme-tokens";

import { buildComposedAdAccessibilityLabel } from "./AdAccessibilityText";
import { HeroImageOverlayTemplate } from "./templates/HeroImageOverlayTemplate";
import { LiveDropCardTemplate } from "./templates/LiveDropCardTemplate";
import { LocalDiscoveryTemplate } from "./templates/LocalDiscoveryTemplate";
import { SignatureItemTemplate } from "./templates/SignatureItemTemplate";
import { SocialMomentTemplate } from "./templates/SocialMomentTemplate";
import { SplitOfferPanelTemplate } from "./templates/SplitOfferPanelTemplate";
import type { ComposedAdCardProps } from "./types";

export type { ComposedAdCardProps } from "./types";

function effectiveTemplateId(props: ComposedAdCardProps) {
  if (props.presentation.templateId === "live_drop_card" && props.liveState.status === "live") {
    return "live_drop_card";
  }
  if (props.presentation.imageSourceType !== "deterministic_fallback") {
    if (props.presentation.templateId === "hero_image_overlay") return "hero_image_overlay";
    if (props.presentation.templateId === "social_moment_card") return "social_moment_card";
    if (props.presentation.templateId === "local_discovery_card") return "local_discovery_card";
    if (props.presentation.templateId === "signature_item_card") return "signature_item_card";
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
  if (templateId === "hero_image_overlay") {
    return <HeroImageOverlayTemplate {...templateProps} />;
  }
  if (templateId === "social_moment_card") {
    return <SocialMomentTemplate {...templateProps} />;
  }
  if (templateId === "local_discovery_card") {
    return <LocalDiscoveryTemplate {...templateProps} />;
  }
  if (templateId === "signature_item_card") {
    return <SignatureItemTemplate {...templateProps} />;
  }
  return <SplitOfferPanelTemplate {...templateProps} />;
}
