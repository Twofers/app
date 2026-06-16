type DealEligibilityDealType =
  | "BUY_ONE_GET_ONE_FREE"
  | "BUY_ONE_GET_SOMETHING_FREE"
  | "PERCENT_OFF_SINGLE_ITEM";

type DealEligibilityInput = {
  dealType?: string | null;
  appliesTo?: string | null;
  discountPercent?: number | string | null;
  requiredPurchaseQuantity?: number | string | null;
  freeItemQuantity?: number | string | null;
  requiredItemDescription?: string | null;
  requiredItemRetailValueCents?: number | string | null;
  freeItemDescription?: string | null;
  freeItemRetailValueCents?: number | string | null;
  freeItemDiscountPercent?: number | string | null;
  itemDescription?: string | null;
  itemRetailValueCents?: number | string | null;
};

type DealEligibilityResult = {
  eligible: boolean;
  customerValuePercent?: number;
};

export type DealOfferContract = {
  businessId: string;
  businessName: string;
  locationId: string;
  locationName: string;
  dealType: DealEligibilityDealType;
  requiredPurchase?: {
    quantity: number;
    itemName: string;
    retailValueCents?: number;
  };
  freeReward?: {
    quantity: number;
    itemName: string;
    retailValueCents?: number;
    discountPercent: 100;
  };
  singleItemDiscount?: {
    itemName: string;
    discountPercent: number;
    retailValueCents?: number;
  };
  customerValuePercent: number;
  activeWindow?: {
    humanReadable?: string;
  };
  quantityLimit?: {
    totalAvailable?: number;
    remaining?: number;
  };
  redemption: {
    redeemAtBusinessName: string;
    redeemAtLocationName: string;
    exactLocationOnly: true;
  };
  canonicalOfferLine: string;
  canonicalShortTerms: string;
  customerFacingSummary: string;
  aiRules: {
    mustUseExactItemNames: string[];
    bannedPhrases: string[];
    allowedPhrases: string[];
    doNotChangeMechanics: true;
  };
};

export type AiDealCopyVariant = {
  headline: string;
  short_description: string;
  push_notification: string;
  social_caption?: string;
};

export type AiDealCopyValidationResult = {
  valid: boolean;
  reasonCodes: string[];
  message?: string;
};

export type AiDealCopySource =
  | "AI_VALIDATED"
  | "AI_RETRY_VALIDATED"
  | "DETERMINISTIC_FALLBACK";

export type ValidatedDealCopy = AiDealCopyVariant & {
  terms_summary: string;
  locked_offer_line: string;
  locked_terms_line: string;
  copy_source: AiDealCopySource;
  variant_count: number;
  selected_variant_index: number | null;
  validation_reason_codes: string[];
};

export type CopyAttemptContext = {
  attemptNumber: 1 | 2;
  validationFeedback?: string;
};

export type GenerateValidatedDealCopyParams = {
  contract: DealOfferContract;
  requestCopy: (context: CopyAttemptContext) => Promise<AiDealCopyVariant[]>;
  logValidationFailure?: (details: {
    attemptNumber: 1 | 2;
    reasonCodes: string[];
  }) => void | Promise<void>;
};

type BuildDealOfferContractParams = {
  businessId: string;
  businessName: string;
  locationId?: string | null;
  locationName?: string | null;
  dealEligibility: DealEligibilityInput;
  eligibilityResult?: DealEligibilityResult;
  activeWindowHumanReadable?: string | null;
  quantityLimit?: number | null;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const clean = value.replace(/[$,%\s]/g, "");
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function positiveQuantity(value: unknown): number {
  const n = numeric(value);
  return n != null && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function positiveCents(value: unknown): number | undefined {
  const n = numeric(value);
  return n != null && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

function sentence(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function canonicalLocationName(params: {
  businessName: string;
  locationName?: string | null;
}): string {
  return cleanText(params.locationName) || cleanText(params.businessName) || "this location";
}

function canonicalFreeItemTerms(
  requiredQuantity: number,
  requiredItem: string,
  freeQuantity: number,
  freeItem: string,
  locationName: string,
  quantityLimit?: number | null,
): string {
  const quantity = Number.isFinite(quantityLimit ?? NaN) && (quantityLimit ?? 0) > 0
    ? `Limited to ${Math.floor(quantityLimit!)} available.`
    : "Limited quantity available.";
  return sentence(
    `Purchase ${requiredQuantity} ${requiredItem} to receive ${freeQuantity} ${freeItem} free. Redeem only at ${locationName}. ${quantity}`,
  );
}

function canonicalPercentTerms(
  discountPercent: number,
  itemName: string,
  locationName: string,
  quantityLimit?: number | null,
): string {
  const quantity = Number.isFinite(quantityLimit ?? NaN) && (quantityLimit ?? 0) > 0
    ? `Limited to ${Math.floor(quantityLimit!)} available.`
    : "Limited quantity available.";
  return sentence(`Get ${discountPercent}% off one ${itemName}. Redeem only at ${locationName}. ${quantity}`);
}

export function buildDealOfferContract(
  params: BuildDealOfferContractParams,
): DealOfferContract | null {
  const eligibility = params.eligibilityResult;
  if (!eligibility?.eligible) return null;

  const dealType = cleanText(params.dealEligibility.dealType) as DealEligibilityDealType;
  const businessName = cleanText(params.businessName) || "this business";
  const locationName = canonicalLocationName({
    businessName,
    locationName: params.locationName,
  });
  const locationId = cleanText(params.locationId) || params.businessId;
  const quantityLimit =
    typeof params.quantityLimit === "number" && Number.isFinite(params.quantityLimit) && params.quantityLimit > 0
      ? Math.floor(params.quantityLimit)
      : null;
  const customerValuePercent =
    typeof eligibility.customerValuePercent === "number" && Number.isFinite(eligibility.customerValuePercent)
      ? eligibility.customerValuePercent
      : 0;

  if (dealType === "BUY_ONE_GET_ONE_FREE" || dealType === "BUY_ONE_GET_SOMETHING_FREE") {
    const requiredItem = cleanText(params.dealEligibility.requiredItemDescription);
    const freeItem =
      dealType === "BUY_ONE_GET_ONE_FREE"
        ? cleanText(params.dealEligibility.freeItemDescription) || requiredItem
        : cleanText(params.dealEligibility.freeItemDescription);
    if (!requiredItem || !freeItem) return null;

    const requiredQuantity = positiveQuantity(params.dealEligibility.requiredPurchaseQuantity);
    const freeQuantity = positiveQuantity(params.dealEligibility.freeItemQuantity);
    const requiredPurchase = {
      quantity: requiredQuantity,
      itemName: requiredItem,
      retailValueCents: positiveCents(params.dealEligibility.requiredItemRetailValueCents),
    };
    const freeReward = {
      quantity: freeQuantity,
      itemName: freeItem,
      retailValueCents: positiveCents(params.dealEligibility.freeItemRetailValueCents),
      discountPercent: 100 as const,
    };
    const canonicalOfferLine = sentence(`Buy one ${requiredItem}, get one ${freeItem} free`);
    const canonicalShortTerms = canonicalFreeItemTerms(
      requiredQuantity,
      requiredItem,
      freeQuantity,
      freeItem,
      locationName,
      quantityLimit,
    );
    const isSameItem = dealType === "BUY_ONE_GET_ONE_FREE";

    return {
      businessId: params.businessId,
      businessName,
      locationId,
      locationName,
      dealType,
      requiredPurchase,
      freeReward,
      customerValuePercent,
      ...(params.activeWindowHumanReadable
        ? { activeWindow: { humanReadable: cleanText(params.activeWindowHumanReadable) } }
        : {}),
      ...(quantityLimit ? { quantityLimit: { totalAvailable: quantityLimit, remaining: quantityLimit } } : {}),
      redemption: {
        redeemAtBusinessName: businessName,
        redeemAtLocationName: locationName,
        exactLocationOnly: true,
      },
      canonicalOfferLine,
      canonicalShortTerms,
      customerFacingSummary: canonicalOfferLine,
      aiRules: {
        mustUseExactItemNames: isSameItem ? [requiredItem] : [requiredItem, freeItem],
        bannedPhrases: isSameItem
          ? ["second item discounted", "buy two", "50% off"]
          : ["BOGO", "2-for-1", "buy both", `buy ${requiredItem} and ${freeItem}`],
        allowedPhrases: isSameItem
          ? ["BOGO", "Buy one, get one free", canonicalOfferLine]
          : [canonicalOfferLine, `free ${freeItem} with your ${requiredItem}`],
        doNotChangeMechanics: true,
      },
    };
  }

  if (dealType === "PERCENT_OFF_SINGLE_ITEM") {
    const itemName = cleanText(params.dealEligibility.itemDescription);
    const discountPercent = Math.round(numeric(params.dealEligibility.discountPercent) ?? 0);
    if (!itemName || discountPercent < 40) return null;

    const canonicalOfferLine = sentence(`${discountPercent}% off one ${itemName}`);
    const canonicalShortTerms = canonicalPercentTerms(
      discountPercent,
      itemName,
      locationName,
      quantityLimit,
    );
    return {
      businessId: params.businessId,
      businessName,
      locationId,
      locationName,
      dealType,
      singleItemDiscount: {
        itemName,
        discountPercent,
        retailValueCents: positiveCents(params.dealEligibility.itemRetailValueCents),
      },
      customerValuePercent,
      ...(params.activeWindowHumanReadable
        ? { activeWindow: { humanReadable: cleanText(params.activeWindowHumanReadable) } }
        : {}),
      ...(quantityLimit ? { quantityLimit: { totalAvailable: quantityLimit, remaining: quantityLimit } } : {}),
      redemption: {
        redeemAtBusinessName: businessName,
        redeemAtLocationName: locationName,
        exactLocationOnly: true,
      },
      canonicalOfferLine,
      canonicalShortTerms,
      customerFacingSummary: canonicalOfferLine,
      aiRules: {
        mustUseExactItemNames: [itemName],
        bannedPhrases: ["BOGO", "buy one get one", "free", "entire order", "sitewide", "all items"],
        allowedPhrases: [canonicalOfferLine, `${discountPercent}% off ${itemName}`],
        doNotChangeMechanics: true,
      },
    };
  }

  return null;
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9%+&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function itemRegex(itemName: string): RegExp {
  const parts = normalizeForSearch(itemName).split(/\s+/).filter(Boolean).map(escapeRegex);
  return new RegExp(`\\b${parts.join("\\s+")}s?\\b`, "i");
}

function containsItem(text: string, itemName: string): boolean {
  if (!cleanText(itemName)) return false;
  return itemRegex(itemName).test(text);
}

function copyText(copy: Partial<AiDealCopyVariant> & { terms_summary?: string }): string {
  return [
    copy.headline,
    copy.short_description,
    copy.push_notification,
    copy.social_caption,
    copy.terms_summary,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateShape(copy: Partial<AiDealCopyVariant>, reasonCodes: string[]): void {
  if (!isNonEmptyString(copy.headline)) reasonCodes.push("EMPTY_HEADLINE");
  if (!isNonEmptyString(copy.short_description)) reasonCodes.push("EMPTY_SHORT_DESCRIPTION");
  if (!isNonEmptyString(copy.push_notification)) reasonCodes.push("EMPTY_PUSH_NOTIFICATION");
  if (isNonEmptyString(copy.headline) && copy.headline.trim().length > 55) reasonCodes.push("HEADLINE_TOO_LONG");
  if (isNonEmptyString(copy.short_description) && copy.short_description.trim().length > 180) {
    reasonCodes.push("SHORT_DESCRIPTION_TOO_LONG");
  }
  if (isNonEmptyString(copy.push_notification) && copy.push_notification.trim().length > 85) {
    reasonCodes.push("PUSH_NOTIFICATION_TOO_LONG");
  }
  if (copy.social_caption != null && (!isNonEmptyString(copy.social_caption) || copy.social_caption.trim().length > 220)) {
    reasonCodes.push("SOCIAL_CAPTION_INVALID");
  }
}

function validateBuyOneGetSomethingFree(
  text: string,
  contract: DealOfferContract,
  reasonCodes: string[],
): void {
  const required = contract.requiredPurchase?.itemName ?? "";
  const free = contract.freeReward?.itemName ?? "";
  const normalized = normalizeForSearch(text);
  const requiredPattern = escapeRegex(normalizeForSearch(required));
  const freePattern = escapeRegex(normalizeForSearch(free));

  if (/\bbogo\b|\b2\s*[- ]?\s*for\s*[- ]?\s*1\b|\btwo\s+for\s+one\b|\b2\s*x\s*1\b/.test(normalized)) {
    reasonCodes.push("GENERIC_BOGO_NOT_ALLOWED");
  }
  if (/\bbuy\s+one\s*,?\s*get\s+one\b|\bbuy\s+1\s*,?\s*get\s+1\b/.test(normalized)) {
    reasonCodes.push("GENERIC_BUY_ONE_GET_ONE_NOT_ALLOWED");
  }
  if (/\bbuy\s+both\b|\bpurchase\s+both\b/.test(normalized)) {
    reasonCodes.push("BUYS_BOTH_ITEMS");
  }
  if (new RegExp(`\\bbuy\\s+(?:a\\s+|one\\s+|1\\s+)?${requiredPattern}\\s*(?:and|&|\\+)\\s+(?:a\\s+|one\\s+|1\\s+)?${freePattern}\\b`).test(normalized)) {
    reasonCodes.push("FREE_ITEM_ADDED_TO_PURCHASE");
  }
  if (/\bget\s+(?:one|1)\s+free\b/.test(normalized)) {
    reasonCodes.push("VAGUE_GET_ONE_FREE");
  }
  if (!containsItem(normalized, required)) reasonCodes.push("MISSING_REQUIRED_ITEM");
  if (!containsItem(normalized, free)) reasonCodes.push("MISSING_FREE_ITEM");
}

function validateBuyOneGetOneFree(
  text: string,
  contract: DealOfferContract,
  reasonCodes: string[],
): void {
  const item = contract.requiredPurchase?.itemName ?? contract.freeReward?.itemName ?? "";
  const normalized = normalizeForSearch(text);
  if (/\bbuy\s+(?:two|2)\b/.test(normalized)) reasonCodes.push("REQUIRES_TWO_PURCHASES");
  if (/\b(second|2nd)\s+(?:item\s+)?(?:50|[1-9]\d)\s*%\s*off\b|\bhalf\s+off\b/.test(normalized)) {
    reasonCodes.push("SECOND_ITEM_DISCOUNTED_NOT_FREE");
  }
  const freeRewardMatches = [...normalized.matchAll(/\bget\s+(?:a|one|1|the)?\s*([a-z0-9][a-z0-9\s-]{1,40}?)\s+free\b/g)];
  for (const match of freeRewardMatches) {
    const candidate = match[1]?.trim() ?? "";
    if (candidate && !containsItem(candidate, item)) {
      reasonCodes.push("CHANGES_FREE_ITEM");
      break;
    }
  }
  if (!containsItem(normalized, item)) reasonCodes.push("MISSING_BOGO_ITEM");
}

function validatePercentOffSingleItem(
  text: string,
  contract: DealOfferContract,
  reasonCodes: string[],
): void {
  const item = contract.singleItemDiscount?.itemName ?? "";
  const discountPercent = contract.singleItemDiscount?.discountPercent ?? 0;
  const normalized = normalizeForSearch(text);
  if (
    /\bbogo\b|\bbuy\s+one\s+get\s+one\b|\bbuy\s+one\s*,?\s*get\s+one\b|\bfree\b|\bgratis\b|\bcomplimentary\b|\bon\s+the\s+house\b|무료/.test(
      normalized,
    )
  ) {
    reasonCodes.push("FREE_OR_BOGO_LANGUAGE_NOT_ALLOWED");
  }
  if (/\bentire\s+order\b|\bsitewide\b|\banything\b|\ball\s+items\b|\bsecond\s+item\b/.test(normalized)) {
    reasonCodes.push("SINGLE_ITEM_SCOPE_CHANGED");
  }
  const percentMatches = [...normalized.matchAll(/\b(\d{1,3})\s*%\s*off\b/g)].map((match) => Number(match[1]));
  if (percentMatches.some((value) => value !== discountPercent)) reasonCodes.push("DISCOUNT_PERCENT_CHANGED");
  if (!normalized.includes(`${discountPercent}%`) && !normalized.includes(`${discountPercent} %`)) {
    reasonCodes.push("MISSING_DISCOUNT_PERCENT");
  }
  if (!containsItem(normalized, item)) reasonCodes.push("MISSING_DISCOUNT_ITEM");
}

export function validateAiCopyAgainstOffer(
  copy: Partial<AiDealCopyVariant> & { terms_summary?: string },
  contract: DealOfferContract,
): AiDealCopyValidationResult {
  const reasonCodes: string[] = [];
  validateShape(copy, reasonCodes);

  const text = copyText(copy);
  if (contract.dealType === "BUY_ONE_GET_SOMETHING_FREE") {
    validateBuyOneGetSomethingFree(text, contract, reasonCodes);
  } else if (contract.dealType === "BUY_ONE_GET_ONE_FREE") {
    validateBuyOneGetOneFree(text, contract, reasonCodes);
  } else {
    validatePercentOffSingleItem(text, contract, reasonCodes);
  }

  return {
    valid: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)],
    ...(reasonCodes.length > 0 ? { message: reasonCodes.join(", ") } : {}),
  };
}

function cleanVariant(copy: Partial<AiDealCopyVariant>): AiDealCopyVariant {
  return {
    headline: cleanText(copy.headline).slice(0, 55),
    short_description: cleanText(copy.short_description).slice(0, 180),
    push_notification: cleanText(copy.push_notification).slice(0, 85),
    ...(isNonEmptyString(copy.social_caption) ? { social_caption: cleanText(copy.social_caption).slice(0, 220) } : {}),
  };
}

export function parseAiDealCopyVariants(content: string): AiDealCopyVariant[] {
  const parsed = JSON.parse(content) as unknown;
  const candidates =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { variants?: unknown }).variants)
      ? (parsed as { variants: unknown[] }).variants
      : [parsed];
  return candidates
    .filter((candidate): candidate is Partial<AiDealCopyVariant> => !!candidate && typeof candidate === "object")
    .map(cleanVariant)
    .filter((variant) => variant.headline || variant.short_description || variant.push_notification)
    .slice(0, 3);
}

function scoreCopy(copy: AiDealCopyVariant, contract: DealOfferContract): number {
  const text = normalizeForSearch(copyText(copy));
  let score = 0;
  for (const item of contract.aiRules.mustUseExactItemNames) {
    if (containsItem(text, item)) score += 2;
  }
  if (contract.dealType === "BUY_ONE_GET_SOMETHING_FREE") {
    if (copy.short_description.length <= 150) score += 1;
    if (containsItem(copy.short_description, contract.requiredPurchase?.itemName ?? "")) score += 2;
    if (containsItem(copy.short_description, contract.freeReward?.itemName ?? "")) score += 2;
  }
  if (contract.dealType === "PERCENT_OFF_SINGLE_ITEM" && text.includes(`${contract.singleItemDiscount?.discountPercent}%`)) {
    score += 2;
  }
  if (containsItem(text, contract.businessName)) score += 1;
  if (/\blimited\b|\bonly\s+\d+\b|\bavailable\b/.test(text)) score += 1;
  if (/\bamazing\b|\bdelicious treat\b|\bdont miss out\b|\bspecial offer\b/.test(text)) score -= 2;
  if (copy.headline && copy.short_description.toLowerCase().startsWith(copy.headline.toLowerCase())) score -= 1;
  return score;
}

export function selectBestValidAiCopy(
  variants: readonly AiDealCopyVariant[],
  contract: DealOfferContract,
): {
  copy: AiDealCopyVariant | null;
  selectedVariantIndex: number | null;
  validCount: number;
  reasonCodes: string[];
} {
  let best: { copy: AiDealCopyVariant; index: number; score: number } | null = null;
  const reasonCodes: string[] = [];
  let validCount = 0;

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]!;
    const validation = validateAiCopyAgainstOffer(variant, contract);
    if (!validation.valid) {
      reasonCodes.push(...validation.reasonCodes);
      continue;
    }
    validCount += 1;
    const score = scoreCopy(variant, contract);
    if (!best || score > best.score) best = { copy: variant, index, score };
  }

  return {
    copy: best?.copy ?? null,
    selectedVariantIndex: best?.index ?? null,
    validCount,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

export function deterministicFallbackCopy(contract: DealOfferContract): AiDealCopyVariant {
  const businessName = contract.businessName;
  if (contract.dealType === "BUY_ONE_GET_SOMETHING_FREE") {
    const required = contract.requiredPurchase?.itemName ?? "item";
    const free = contract.freeReward?.itemName ?? "item";
    return cleanVariant({
      headline: `Free ${free} with your ${required}`,
      short_description: `Buy one ${required} at ${businessName} and get one ${free} free. Limited quantities available.`,
      push_notification: `Buy ${required}, get ${free} free at ${businessName}.`,
      social_caption: `Limited-time Twofer: buy one ${required}, get one ${free} free at ${businessName}.`,
    });
  }
  if (contract.dealType === "BUY_ONE_GET_ONE_FREE") {
    const item = contract.requiredPurchase?.itemName ?? contract.freeReward?.itemName ?? "item";
    return cleanVariant({
      headline: `Buy one ${item}, get one ${item} free`,
      short_description: `Stop by ${businessName} for a limited-time BOGO: buy one ${item}, get one ${item} free.`,
      push_notification: `BOGO ${item} at ${businessName}.`,
      social_caption: `Limited-time Twofer: buy one ${item}, get one free at ${businessName}.`,
    });
  }
  const item = contract.singleItemDiscount?.itemName ?? "item";
  const discount = contract.singleItemDiscount?.discountPercent ?? 40;
  return cleanVariant({
    headline: `${discount}% off one ${item}`,
    short_description: `Get ${discount}% off one ${item} at ${businessName}. Limited quantities available.`,
    push_notification: `${discount}% off ${item} at ${businessName}.`,
    social_caption: `Limited-time Twofer: get ${discount}% off one ${item} at ${businessName}.`,
  });
}

function lockCopy(
  copy: AiDealCopyVariant,
  contract: DealOfferContract,
  source: AiDealCopySource,
  variantCount: number,
  selectedVariantIndex: number | null,
  validationReasonCodes: string[],
): ValidatedDealCopy {
  return {
    ...cleanVariant(copy),
    terms_summary: contract.canonicalShortTerms,
    locked_offer_line: contract.canonicalOfferLine,
    locked_terms_line: contract.canonicalShortTerms,
    copy_source: source,
    variant_count: variantCount,
    selected_variant_index: selectedVariantIndex,
    validation_reason_codes: [...new Set(validationReasonCodes)],
  };
}

function feedbackFor(reasonCodes: readonly string[], contract: DealOfferContract): string {
  const correctDeal = [
    `Correct deal: ${contract.canonicalOfferLine}`,
    contract.requiredPurchase ? `Customer buys ${contract.requiredPurchase.quantity} ${contract.requiredPurchase.itemName}.` : "",
    contract.freeReward ? `Customer gets ${contract.freeReward.quantity} ${contract.freeReward.itemName} free.` : "",
    contract.singleItemDiscount
      ? `Customer gets ${contract.singleItemDiscount.discountPercent}% off one ${contract.singleItemDiscount.itemName}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    "Your previous copy changed or obscured the deal mechanics.",
    `Validation errors: ${reasonCodes.join(", ") || "NO_VALID_VARIANTS"}.`,
    correctDeal,
    "Rewrite the copy without changing the deal. Return JSON only.",
  ].join("\n");
}

export async function generateValidatedDealCopy(
  params: GenerateValidatedDealCopyParams,
): Promise<ValidatedDealCopy> {
  const firstVariants = await params.requestCopy({ attemptNumber: 1 });
  const firstSelection = selectBestValidAiCopy(firstVariants, params.contract);
  if (firstSelection.copy) {
    return lockCopy(
      firstSelection.copy,
      params.contract,
      "AI_VALIDATED",
      firstVariants.length,
      firstSelection.selectedVariantIndex,
      firstSelection.reasonCodes,
    );
  }

  await params.logValidationFailure?.({
    attemptNumber: 1,
    reasonCodes: firstSelection.reasonCodes,
  });

  const secondVariants = await params.requestCopy({
    attemptNumber: 2,
    validationFeedback: feedbackFor(firstSelection.reasonCodes, params.contract),
  });
  const secondSelection = selectBestValidAiCopy(secondVariants, params.contract);
  if (secondSelection.copy) {
    return lockCopy(
      secondSelection.copy,
      params.contract,
      "AI_RETRY_VALIDATED",
      secondVariants.length,
      secondSelection.selectedVariantIndex,
      secondSelection.reasonCodes,
    );
  }

  await params.logValidationFailure?.({
    attemptNumber: 2,
    reasonCodes: secondSelection.reasonCodes,
  });

  const fallback = deterministicFallbackCopy(params.contract);
  const fallbackValidation = validateAiCopyAgainstOffer(fallback, params.contract);
  if (!fallbackValidation.valid) {
    throw new Error(`DETERMINISTIC_FALLBACK_INVALID:${fallbackValidation.reasonCodes.join(",")}`);
  }
  return lockCopy(
    fallback,
    params.contract,
    "DETERMINISTIC_FALLBACK",
    secondVariants.length,
    null,
    secondSelection.reasonCodes,
  );
}
