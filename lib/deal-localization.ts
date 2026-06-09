export type LocalizedDealFields = {
  title?: string | null;
  description?: string | null;
  title_es?: string | null;
  title_ko?: string | null;
  description_es?: string | null;
  description_ko?: string | null;
};

function baseLanguage(language: string): string {
  return language.split("-")[0]?.toLowerCase() ?? "en";
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function localizedDealTitle(deal: LocalizedDealFields, language: string): string {
  const lang = baseLanguage(language);
  if (lang === "es") return present(deal.title_es) ?? present(deal.title) ?? "";
  if (lang === "ko") return present(deal.title_ko) ?? present(deal.title) ?? "";
  return present(deal.title) ?? "";
}

export function localizedDealDescription(deal: LocalizedDealFields, language: string): string {
  const lang = baseLanguage(language);
  if (lang === "es") return present(deal.description_es) ?? present(deal.description) ?? "";
  if (lang === "ko") return present(deal.description_ko) ?? present(deal.description) ?? "";
  return present(deal.description) ?? "";
}
