import type { TFunction } from "i18next";
import { BUSINESS_CATEGORY_IDS, type BusinessCategoryId } from "./business-signup";

const LOCALIZED_CATEGORY_IDS = new Set<BusinessCategoryId>(
  BUSINESS_CATEGORY_IDS.filter((id) => id !== "other"),
);

export function localizedBusinessCategoryLabel(
  category: string | null | undefined,
  t: TFunction,
): string | null {
  const trimmed = category?.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase() as BusinessCategoryId;
  if (LOCALIZED_CATEGORY_IDS.has(normalized)) {
    return t(`businessSetup.cat.${normalized}`);
  }

  return trimmed;
}
