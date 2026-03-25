import { enUS, es, ko } from "date-fns/locale";

/** date-fns locale from i18next language tag */
export function dateFnsLocaleFor(lang: string | undefined) {
  const base = lang?.split("-")[0] ?? "en";
  if (base === "ko") return ko;
  if (base === "es") return es;
  return enUS;
}
