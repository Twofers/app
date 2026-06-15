export type QuickDealFullBuilderDraft = {
  hint?: string | null;
  title?: string | null;
  offerLine?: string | null;
  cta?: string | null;
  posterPath?: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function buildQuickDealFullBuilderParams(draft: QuickDealFullBuilderDraft): Record<string, string> {
  const params: Record<string, string> = { fromCreateHub: "1" };
  const hint = clean(draft.hint);
  const title = clean(draft.title);
  const offerLine = clean(draft.offerLine);
  const cta = clean(draft.cta);
  const posterPath = clean(draft.posterPath);

  if (hint) params.prefillHint = hint;
  if (title) params.prefillTitle = title;
  if (offerLine) {
    params.prefillPromoLine = offerLine;
    params.prefillDescription = offerLine;
  }
  if (cta) params.prefillCta = cta;
  if (posterPath) params.prefillPosterPath = posterPath;

  return params;
}
