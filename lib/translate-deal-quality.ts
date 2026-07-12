import type { DealQualityResult } from "./deal-quality";
import type { AppLocale } from "./i18n/config";
import i18n, { isAppLocale } from "./i18n/config";


/**
 * Localized banner for blocked deal-quality checks.
 * English strings in `result.message` stay the regression baseline; this uses JSON copy.
 */
export function translateDealQualityBlock(
  result: DealQualityResult,
  language: string | null | undefined,
): string {
  if (!result.blocked || !result.blockReason) return result.message;
  const lng: AppLocale = isAppLocale(language) ? language : "en";
  const key = `dealQuality.blocks.${result.blockReason}`;
  const translated = i18n.t(key, { lng });
  if (!translated || translated === key) return result.message;
  return translated;
}

/**
 * Language for AI `output_language` + deal-quality banners on create flows.
 * Create flows follow the active app language. A stored business preferred
 * locale can be stale after customer/business QA account switches, so it must
 * not override the language the business owner is currently using.
 * Matrix tests: `lib/resolve-deal-flow-language.locale.test.ts`.
 */
export function resolveDealFlowLanguage(
  _businessPreferredLocale: string | null | undefined,
  appLanguage: string,
): AppLocale {
  return isAppLocale(appLanguage) ? appLanguage : "en";
}
