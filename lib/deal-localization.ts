import { getDealDisplayTitle } from "./deal-display-copy";

export type LocalizedDealFields = {
  source_locale?: string | null;
  title?: string | null;
  description?: string | null;
  title_en?: string | null;
  title_es?: string | null;
  title_ko?: string | null;
  description_en?: string | null;
  description_es?: string | null;
  description_ko?: string | null;
};

type DealLocale = "en" | "es" | "ko";

function baseLanguage(language: string | null | undefined): DealLocale {
  const lang = language?.split("-")[0]?.toLowerCase();
  return lang === "es" || lang === "ko" ? lang : "en";
}

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function localizedDealTitle(deal: LocalizedDealFields, language: string): string {
  const lang = baseLanguage(language);
  const localized =
    lang === "en"
      ? present(deal.title_en) ?? present(deal.title) ?? ""
      : lang === "es"
        ? present(deal.title_es) ?? present(deal.title) ?? ""
        : present(deal.title_ko) ?? present(deal.title) ?? "";
  return getDealDisplayTitle(deal, localized);
}

export function localizedDealDescription(deal: LocalizedDealFields, language: string): string {
  const lang = baseLanguage(language);
  if (lang === "en") return present(deal.description_en) ?? present(deal.description) ?? "";
  if (lang === "es") return present(deal.description_es) ?? present(deal.description) ?? "";
  return present(deal.description_ko) ?? present(deal.description) ?? "";
}
