import { splitSubheadlineForPromoAndBody } from "./menu-ad-copy";
import type { GeneratedAd } from "./ad-variants";

export type QuickPrefillParams = {
  prefillTitle: string;
  prefillHint: string;
  prefillLocationId?: string;
  fromMenuOffer: "1";
};

export function buildQuickPrefillFromMenuOffer(ad: GeneratedAd, primaryLocationId?: string): QuickPrefillParams {
  const title = ad.headline.trim();
  const cta = ad.cta.trim();
  const parts = splitSubheadlineForPromoAndBody(ad.subheadline ?? "");
  const hintSections = [parts.promoLine.trim(), parts.bodyCopy.trim(), cta].filter((v) => v.length > 0);

  return {
    prefillTitle: title,
    prefillHint: hintSections.join("\n"),
    ...(primaryLocationId ? { prefillLocationId: primaryLocationId } : {}),
    fromMenuOffer: "1",
  };
}
