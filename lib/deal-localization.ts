import { getDealDisplayDescription, getDealDisplayTitle, type DealDisplayTitleFields } from "./deal-display-copy";

export type LocalizedDealFields = DealDisplayTitleFields & {
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

function normalizeComparison(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function localizedTitleField(deal: LocalizedDealFields, lang: DealLocale): string | null {
  if (lang === "es") return present(deal.title_es);
  if (lang === "ko") return present(deal.title_ko);
  return present(deal.title_en) ?? present(deal.title);
}

function localizedDescriptionField(deal: LocalizedDealFields, lang: DealLocale): string | null {
  if (lang === "es") return present(deal.description_es);
  if (lang === "ko") return present(deal.description_ko);
  return present(deal.description_en) ?? present(deal.description);
}

export function localizedDealTitle(deal: LocalizedDealFields, language: string): string {
  const lang = baseLanguage(language);
  const localized = localizedTitleField(deal, lang);
  if (lang !== "en" && localized) return localized;
  return getDealDisplayTitle(deal, localized);
}

export function localizedDealDescription(deal: LocalizedDealFields, language: string): string {
  const lang = baseLanguage(language);
  const description = localizedDescriptionField(deal, lang);
  const title = localizedDealTitle(deal, language);
  if (lang !== "en" && description) {
    return normalizeComparison(description) === normalizeComparison(title) ? "" : description;
  }
  return getDealDisplayDescription(deal, description, title);
}
