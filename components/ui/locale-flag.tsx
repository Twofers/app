import { SvgXml } from "react-native-svg";
import US from "country-flag-icons/string/3x2/US";
import MX from "country-flag-icons/string/3x2/MX";
import KR from "country-flag-icons/string/3x2/KR";
import type { AppLocale } from "@/lib/i18n/config";

// Spanish maps to Mexico's flag: TWOFER's DFW/Texas Spanish-speaking base is
// largely Mexican-American. All flags use country-flag-icons' uniform 3x2
// viewBox, so a single 3:2 size renders every flag without distortion.
const FLAG_SVG_BY_LOCALE: Record<AppLocale, string> = {
  en: US,
  es: MX,
  ko: KR,
};

export function LocaleFlag({ locale, width = 40 }: { locale: AppLocale; width?: number }) {
  const height = Math.round((width * 2) / 3);
  return <SvgXml xml={FLAG_SVG_BY_LOCALE[locale]} width={width} height={height} />;
}
