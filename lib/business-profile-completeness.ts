type ProfileFields = {
  name: string | null | undefined;
  address: string | null | undefined;
  phone: string | null | undefined;
  category: string | null | undefined;
  hours_text: string | null | undefined;
  short_description: string | null | undefined;
  contact_name: string | null | undefined;
  business_email: string | null | undefined;
};

export type CompletenessResult = {
  percentage: number;
  filledCount: number;
  totalCount: number;
  missingFields: string[];
  /** i18n key for the most impactful missing field, or null if 100% */
  nextHint: string | null;
};

/**
 * Priority-ordered fields: first missing field in this list becomes the hint.
 * Order reflects customer impact (category/hours are most useful to consumers).
 */
const FIELD_HINTS: { key: keyof ProfileFields; hint: string }[] = [
  { key: "category", hint: "account.profileHintCategory" },
  { key: "hours_text", hint: "account.profileHintHours" },
  { key: "short_description", hint: "account.profileHintDescription" },
  { key: "phone", hint: "account.profileHintPhone" },
  { key: "contact_name", hint: "account.profileHintContact" },
  { key: "business_email", hint: "account.profileHintEmail" },
  { key: "address", hint: "account.profileHintAddress" },
  { key: "name", hint: "account.profileHintName" },
];

function isFilled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function calculateProfileCompleteness(
  profile: ProfileFields | null,
): CompletenessResult {
  const totalCount = FIELD_HINTS.length;

  if (!profile) {
    return {
      percentage: 0,
      filledCount: 0,
      totalCount,
      missingFields: FIELD_HINTS.map((f) => f.key),
      nextHint: FIELD_HINTS[0].hint,
    };
  }

  const missingFields: string[] = [];
  let firstHint: string | null = null;

  for (const { key, hint } of FIELD_HINTS) {
    if (!isFilled(profile[key])) {
      missingFields.push(key);
      if (!firstHint) firstHint = hint;
    }
  }

  const filledCount = totalCount - missingFields.length;
  const percentage = Math.round((filledCount / totalCount) * 100);

  return { percentage, filledCount, totalCount, missingFields, nextHint: firstHint };
}
