import type { AdPresentationSpec } from "@/lib/ad-presentation-spec";
import type { PosterSpecV1 } from "@/lib/poster/posterTypes";
import type {
  ApprovedAdCopy,
  ComposedAdCardSurface,
  DealLiveState,
  ImmutableOfferFacts,
  MerchantDisplayIdentity,
} from "@/lib/ad-render-content";
import type { AdThemeTokens } from "@/lib/ad-theme-tokens";
import type { SupportedLocale } from "@/lib/supported-locales";

export type ComposedAdSecondaryAction = {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
};

/**
 * Save/favorite affinity action rendered as a heart overlay on the card image
 * (not inside the claim button block). Browse-time action, kept visually distinct
 * from the primary claim CTA.
 */
export type ComposedAdFavoriteAction = {
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
  posterSpec?: PosterSpecV1 | null;
  /** Viewer's app language, threaded to the poster template for locale-aware poster copy. */
  contentLocale?: SupportedLocale | null;
  fallbackVisualLabel?: string | null;
  onPrimaryAction?: () => void;
  onCardPress?: () => void;
  secondaryAction?: ComposedAdSecondaryAction | null;
  favoriteAction?: ComposedAdFavoriteAction | null;
};

export type ComposedAdTemplateProps = ComposedAdCardProps & {
  tokens: AdThemeTokens;
  accessibilityLabel: string;
};
