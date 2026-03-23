import type { DealQualityResult } from "./deal-quality";
import type { AppLocale } from "./i18n/config";
import { isAppLocale } from "./i18n/config";
import i18n from "./i18n/config";

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
 * - `businessPreferredLocale === null` → same as app (i18n) language.
 * - Explicit `en` | `es` | `ko` on the business row → overrides app for those flows only.
 * Matrix tests: `lib/resolve-deal-flow-language.locale.test.ts`.
 */
export function resolveDealFlowLanguage(
  businessPreferredLocale: string | null | undefined,
  appLanguage: string,
): AppLocale {
  if (isAppLocale(businessPreferredLocale)) return businessPreferredLocale;
  return isAppLocale(appLanguage) ? appLanguage : "en";
}
