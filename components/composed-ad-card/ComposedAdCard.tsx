import { resolveAdThemeTokens } from "@/lib/ad-theme-tokens";

import { buildComposedAdAccessibilityLabel } from "./AdAccessibilityText";
import { SplitOfferPanelTemplate } from "./templates/SplitOfferPanelTemplate";
import type { ComposedAdCardProps } from "./types";

export type { ComposedAdCardProps } from "./types";

export function ComposedAdCard(props: ComposedAdCardProps) {
  const tokens = resolveAdThemeTokens(props.presentation.themeId);
  const accessibilityLabel = buildComposedAdAccessibilityLabel(props);
  const templateProps = { ...props, tokens, accessibilityLabel };

  return <SplitOfferPanelTemplate {...templateProps} />;
}
