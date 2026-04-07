import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ko from "./locales/ko.json";
import esCreateAiOverrides from "./locales/es.createAi.overrides.json";
import koCreateAiOverrides from "./locales/ko.createAi.overrides.json";

/**
 * ES/KO createAi merge: English defaults → base locale keys → overrides.
 * Previously base locale translations (es.createAi / ko.createAi) were
 * clobbered because only overrides layered on English. Now all three layers
 * merge so keys translated in es.json/ko.json are preserved.
 */
const esTranslation = {
  ...es,
  createAi: { ...en.createAi, ...es.createAi, ...esCreateAiOverrides },
};
const koTranslation = {
  ...ko,
  createAi: { ...en.createAi, ...ko.createAi, ...koCreateAiOverrides },
};

export const APP_LOCALES = ["en", "es", "ko"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "en" || value === "es" || value === "ko";
}

void i18n.use(initReactI18next).init({
  compatibilityJSON: "v4",
  resources: {
    en: { translation: en },
    es: { translation: esTranslation },
    ko: { translation: koTranslation },
  },
  fallbackLng: "en",
  lng: "en",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
