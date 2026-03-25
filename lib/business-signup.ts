/** Stable IDs for category chips; labels come from i18n `businessSetup.category.*`. */
export const BUSINESS_CATEGORY_IDS = [
  "restaurant",
  "cafe",
  "bakery",
  "retail",
  "salon",
  "gym",
  "services",
  "other",
] as const;

export type BusinessCategoryId = (typeof BUSINESS_CATEGORY_IDS)[number];

/** Preset hours strings stored in `hours_text`; labels from `businessSetup.hoursPreset.*`. */
export const BUSINESS_HOURS_PRESET_IDS = [
  "weekday_9_5",
  "daily_8_8",
  "weekends",
  "late_night",
  "custom_prompt",
] as const;

export type BusinessHoursPresetId = (typeof BUSINESS_HOURS_PRESET_IDS)[number];

/** English defaults for DB when a preset is chosen (localized label shown in UI only). */
export const HOURS_PRESET_DB_VALUE: Record<Exclude<BusinessHoursPresetId, "custom_prompt">, string> = {
  weekday_9_5: "Mon–Fri 9am–5pm",
  daily_8_8: "Daily 8am–8pm",
  weekends: "Sat–Sun 10am–6pm",
  late_night: "Open late · check Instagram for hours",
};
