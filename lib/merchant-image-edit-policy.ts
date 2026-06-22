export type MerchantImageEditInstructionValidation = {
  ok: boolean;
  instruction: string;
  reasonCodes: string[];
};

const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/\b(add|include|insert|put)\b.+\b(text|words?|letters?|caption|slogan|headline|price|discount|coupon|qr|barcode|logo)\b/i, "ADDS_FORBIDDEN_GRAPHICS"],
  [/\b(remove|hide|delete|erase)\b.+\b(item|food|drink|product|free|paid|second|extra)\b/i, "REMOVES_OFFER_ITEM"],
  [/\b(change|swap|replace|turn)\b.+\b(item|food|drink|product|latte|coffee|tea|beer|wine|burger|taco|pizza|sandwich|bowl)\b/i, "CHANGES_OFFER_ITEM"],
  [/\b(two|three|four|five|six|\d+)\b.+\b(extra|more|additional|items?|cups?|plates?|servings?)\b/i, "CHANGES_ITEM_COUNT"],
  [/\b(price|pricing|coupon|discount|percent|%\s*off|free|bogo|twofer|2\s*for\s*1|buy\s*one|get\s*one)\b/i, "CHANGES_OFFER_TERMS"],
  [/\b(competitor|brand|trademark|mcdonald|starbucks|dunkin|chipotle|coca[-\s]?cola|pepsi)\b/i, "REQUESTS_THIRD_PARTY_BRAND"],
  [/\b(animal|mascot|cartoon|character|person|hand|face|model)\b/i, "REQUESTS_DISTRACTING_ELEMENT"],
];

function cleanInstruction(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 400)
    : "";
}

export function validateMerchantImageEditInstruction(
  value: unknown,
): MerchantImageEditInstructionValidation {
  const instruction = cleanInstruction(value);
  if (!instruction) return { ok: true, instruction: "", reasonCodes: [] };
  const reasonCodes = BLOCKED_PATTERNS
    .filter(([pattern]) => pattern.test(instruction))
    .map(([, code]) => code);
  return {
    ok: reasonCodes.length === 0,
    instruction,
    reasonCodes: [...new Set(reasonCodes)],
  };
}
