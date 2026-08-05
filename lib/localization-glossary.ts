/**
 * Shared bilingual glossary for core app vocabulary (AI_SHARED_GLOSSARY_ENABLED).
 *
 * These es/ko renderings are not invented for this file — each one is pulled
 * from a string the app already prints today, either the deterministic offer
 * renderer or the app's own locale JSON, so an AI localization pass that
 * falls back to this glossary stays consistent with what a customer already
 * sees everywhere else in the app. Source lines cited below (paths relative
 * to the repo root; line numbers as of the commit that added this file —
 * re-verify against the current file if a locale key moves):
 *
 *  - deal:        lib/i18n/locales/es.json:815  dealDetail."dealFallback": "Oferta"
 *                 lib/i18n/locales/ko.json:815  dealDetail."dealFallback": "딜"
 *  - claim:       lib/i18n/locales/es.json:829  dealDetail."claim": "Reclamar"
 *                 lib/i18n/locales/ko.json:829  dealDetail."claim": "받기"
 *  - redeem:      lib/i18n/locales/es.json:10   tabs."redeem": "Canjear"
 *                 lib/i18n/locales/ko.json:10   tabs."redeem": "사용"
 *  - free:        lib/localized-offer-renderer.ts renderSpanishLine — "...recibes N {reward} gratis"
 *                 lib/localized-offer-renderer.ts renderKoreanLine — "...{reward} N개 무료"
 *  - second item: lib/i18n/locales/es.json:346  dealQuality.strongGuard."second_item_discount" — "el segundo artículo"
 *                 lib/i18n/locales/ko.json:346  dealQuality.strongGuard."second_item_discount" — "두 번째 품목"
 *  - today only:  lib/i18n/locales/es.json:1975 createAi."hintPlaceholder" — "solo hoy"
 *                 lib/i18n/locales/ko.json:1975 createAi."hintPlaceholder" — "오늘만"
 *  - wallet:      lib/i18n/locales/es.json:8    tabs."wallet": "Billetera"
 *                 lib/i18n/locales/ko.json:8    tabs."wallet": "지갑"
 */

export type LocalizationGlossaryTerm = {
  /** Canonical English term (lowercase, for lookup/matching). */
  en: string;
  es: string;
  ko: string;
};

export const LOCALIZATION_GLOSSARY_TERMS: readonly LocalizationGlossaryTerm[] = [
  { en: "deal", es: "oferta", ko: "딜" },
  { en: "claim", es: "reclamar", ko: "받기" },
  { en: "redeem", es: "canjear", ko: "사용" },
  { en: "free", es: "gratis", ko: "무료" },
  { en: "second item", es: "segundo artículo", ko: "두 번째 품목" },
  { en: "today only", es: "solo hoy", ko: "오늘만" },
  { en: "wallet", es: "billetera", ko: "지갑" },
];

/**
 * Look up a single glossary term by its canonical English key (case-insensitive).
 */
export function localizationGlossaryTerm(en: string): LocalizationGlossaryTerm | null {
  const key = en.trim().toLowerCase();
  return LOCALIZATION_GLOSSARY_TERMS.find((entry) => entry.en === key) ?? null;
}

/**
 * Prompt-shaped view of the glossary — the shape ai-localization-provider.ts's
 * `localizedTerms` slot already expects (an array of small objects dropped
 * into the prompt as JSON). Kept separate from LOCALIZATION_GLOSSARY_TERMS so
 * callers that just want the raw term list aren't coupled to this shape.
 */
export type LocalizationGlossaryPromptTerm = { term: string; es: string; ko: string };

export function localizationGlossaryAsPromptTerms(): LocalizationGlossaryPromptTerm[] {
  return LOCALIZATION_GLOSSARY_TERMS.map((entry) => ({ term: entry.en, es: entry.es, ko: entry.ko }));
}
