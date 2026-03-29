/**
 * Display helpers for AI ad cards when API uses a single subheadline field.
 * Splits into a short promo line + body copy for clearer UX.
 */

export type PromoBodySplit = {
  promoLine: string;
  bodyCopy: string;
};

/** First sentence (ends at . ! ?) as promo; remainder as body. Fallback: truncate promo. */
export function splitSubheadlineForPromoAndBody(subheadline: string): PromoBodySplit {
  const t = subheadline.trim();
  if (!t) return { promoLine: "", bodyCopy: "" };

  const sentenceEnd = t.search(/[.!?](\s|$)/);
  if (sentenceEnd >= 0) {
    const promoLine = t.slice(0, sentenceEnd + 1).trim();
    const bodyCopy = t.slice(sentenceEnd + 1).trim();
    if (bodyCopy.length > 0) {
      return { promoLine, bodyCopy };
    }
    return { promoLine, bodyCopy: "" };
  }

  if (t.length <= 56) {
    return { promoLine: t, bodyCopy: "" };
  }

  /** No sentence break: short teaser + remainder only (never duplicate full subheadline). */
  const take = 53;
  const teaser = t.slice(0, take).trimEnd();
  const bodyCopy = t.slice(take).trim();
  if (!bodyCopy) {
    return { promoLine: t, bodyCopy: "" };
  }
  return { promoLine: `${teaser}…`, bodyCopy };
}
