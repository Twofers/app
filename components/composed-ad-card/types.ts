import type { AdPresentationSpec } from "@/lib/ad-presentation-spec";
import type {
  ApprovedAdCopy,
  ComposedAdCardSurface,
  DealLiveState,
  ImmutableOfferFacts,
  MerchantDisplayIdentity,
} from "@/lib/ad-render-content";
import type { AdThemeTokens } from "@/lib/ad-theme-tokens";

export type ComposedAdSecondaryAction = {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export type ComposedAdCardProps = {
  offerFacts: ImmutableOfferFacts;
  merchant: MerchantDisplayIdentity;
  copy: ApprovedAdCopy;
  presentation: AdPresentationSpec;
  liveState: DealLiveState;
  surface: ComposedAdCardSurface;
  imageUri?: string | null;
  fallbackVisualLabel?: string | null;
  onPrimaryAction?: () => void;
  onCardPress?: () => void;
  secondaryAction?: ComposedAdSecondaryAction | null;
};

export type ComposedAdTemplateProps = ComposedAdCardProps & {
  tokens: AdThemeTokens;
  accessibilityLabel: string;
};
