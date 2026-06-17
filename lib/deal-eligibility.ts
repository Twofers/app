export const MIN_CUSTOMER_VALUE_PERCENT = 40;

export type DealEligibilityStatus = "VALID" | "INVALID";

export type DealEligibilityDealType =
  | "BUY_ONE_GET_ONE_FREE"
  | "BUY_ONE_GET_SOMETHING_FREE"
  | "PERCENT_OFF_SINGLE_ITEM";

export type DealAppliesTo = "SINGLE_ITEM" | "ENTIRE_ORDER" | "SECOND_ITEM";

export type DealRejectionReason =
  | "INVALID_DEAL_TYPE"
  | "DISCOUNT_TOO_LOW"
  | "TOTAL_CUSTOMER_VALUE_TOO_LOW"
  | "ENTIRE_ORDER_DISCOUNT_NOT_ALLOWED"
  | "SECOND_ITEM_DISCOUNT_NOT_ALLOWED"
  | "MISSING_REQUIRED_ITEM"
  | "MISSING_REQUIRED_ITEM_VALUE"
  | "MISSING_FREE_ITEM_DESCRIPTION"
  | "MISSING_FREE_ITEM_VALUE"
  | "FREE_ITEM_MUST_BE_100_PERCENT_FREE";

export type DealEligibilityInput = {
  dealType?: string | null;
  appliesTo?: string | null;
  discountPercent?: number | string | null;
  requiredPurchaseQuantity?: number | string | null;
  freeItemQuantity?: number | string | null;
  requiredItemId?: string | null;
  requiredItemDescription?: string | null;
  requiredItemRetailValueCents?: number | string | null;
  freeItemDescription?: string | null;
  freeItemRetailValueCents?: number | string | null;
  freeItemDiscountPercent?: number | string | null;
  itemId?: string | null;
  itemDescription?: string | null;
  itemRetailValueCents?: number | string | null;
};

export type DealEligibilityResult = {
  eligible: boolean;
  eligibilityStatus: DealEligibilityStatus;
  reasonCode?: DealRejectionReason;
  message?: string;
  fieldErrors?: Record<string, string>;
  customerValuePercent?: number;
};

const ALLOWED_DEAL_TYPES: ReadonlySet<DealEligibilityDealType> = new Set([
  "BUY_ONE_GET_ONE_FREE",
  "BUY_ONE_GET_SOMETHING_FREE",
  "PERCENT_OFF_SINGLE_ITEM",
]);

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value: unknown): string {
  return cleanText(value).toUpperCase();
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

function positiveCents(value: unknown): number | null {
  const n = numeric(value);
  if (n == null || n <= 0) return null;
  return Math.round(n);
}

function positiveQuantity(value: unknown, fallback = 1): number {
  const n = numeric(value);
  if (n == null) return fallback;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
}

function hasItem(id: unknown, description: unknown): boolean {
  return cleanText(id).length > 0 || cleanText(description).length > 0;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function invalid(
  reasonCode: DealRejectionReason,
  message: string,
  fieldErrors?: Record<string, string>,
  customerValuePercent?: number,
): DealEligibilityResult {
  return {
    eligible: false,
    eligibilityStatus: "INVALID",
    reasonCode,
    message,
    ...(fieldErrors && Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    ...(customerValuePercent != null ? { customerValuePercent: roundPercent(customerValuePercent) } : {}),
  };
}

function valid(customerValuePercent?: number): DealEligibilityResult {
  return {
    eligible: true,
    eligibilityStatus: "VALID",
    ...(customerValuePercent != null ? { customerValuePercent: roundPercent(customerValuePercent) } : {}),
  };
}

function normalizeDealType(value: unknown): DealEligibilityDealType | null {
  const token = normalizeToken(value);
  return ALLOWED_DEAL_TYPES.has(token as DealEligibilityDealType)
    ? (token as DealEligibilityDealType)
    : null;
}

function normalizeAppliesTo(value: unknown): DealAppliesTo {
  const token = normalizeToken(value);
  if (token === "ENTIRE_ORDER" || token === "ORDER" || token === "ALL_ITEMS") return "ENTIRE_ORDER";
  if (token === "SECOND_ITEM" || token === "SECOND_ITEM_DISCOUNT") return "SECOND_ITEM";
  return "SINGLE_ITEM";
}

function looksLikeSecondItemDiscount(rawType: unknown): boolean {
  const token = normalizeToken(rawType);
  return (
    token.includes("SECOND") ||
    token.includes("HALF_OFF") ||
    token.includes("50_OFF") ||
    token.includes("80_OFF") ||
    token.includes("PERCENT_OFF_SECOND")
  );
}

function freeItemCustomerValuePercent(requiredValueCents: number, freeValueCents: number): number {
  return (freeValueCents / (requiredValueCents + freeValueCents)) * 100;
}

function validateFreeItemDeal(
  input: DealEligibilityInput,
  dealType: Extract<DealEligibilityDealType, "BUY_ONE_GET_ONE_FREE" | "BUY_ONE_GET_SOMETHING_FREE">,
): DealEligibilityResult {
  const fieldErrors: Record<string, string> = {};
  const requiredQty = positiveQuantity(input.requiredPurchaseQuantity);
  const freeQty = positiveQuantity(input.freeItemQuantity);
  const requiredItemValue = positiveCents(input.requiredItemRetailValueCents);
  const freeItemValue = positiveCents(input.freeItemRetailValueCents);
  const freeDiscount = numeric(input.freeItemDiscountPercent);
  const freeDescription = cleanText(input.freeItemDescription);
  const hasRequiredItem = hasItem(input.requiredItemId, input.requiredItemDescription);

  if (requiredQty < 1 || !hasRequiredItem) {
    fieldErrors.requiredItemDescription = "Enter the item customers must buy.";
  }

  if (dealType === "BUY_ONE_GET_SOMETHING_FREE" && !freeDescription) {
    fieldErrors.freeItemDescription = "Enter the free item customers receive.";
  }

  if (freeQty < 1) {
    fieldErrors.freeItemQuantity = "Enter how many free items customers receive.";
  }

  if (freeDiscount == null || freeDiscount !== 100) {
    fieldErrors.freeItemDiscountPercent = "The reward item must be 100% free.";
  }

  if (fieldErrors.freeItemDiscountPercent) {
    return invalid(
      "FREE_ITEM_MUST_BE_100_PERCENT_FREE",
      "Twofer only supports free-item offers or at least 40% off a single item. Discounted second-item deals are not eligible.",
      fieldErrors,
    );
  }

  if (fieldErrors.freeItemDescription) {
    return invalid(
      "MISSING_FREE_ITEM_DESCRIPTION",
      "Enter the free item customers receive.",
      fieldErrors,
    );
  }

  if (fieldErrors.requiredItemDescription) {
    return invalid(
      "MISSING_REQUIRED_ITEM",
      "Enter the item customers must buy.",
      fieldErrors,
    );
  }

  if (fieldErrors.freeItemQuantity) {
    return invalid(
      "MISSING_FREE_ITEM_VALUE",
      "Enter how many free items customers receive.",
      fieldErrors,
    );
  }

  const customerValuePercent =
    requiredItemValue != null && freeItemValue != null
      ? freeItemCustomerValuePercent(requiredItemValue, freeItemValue)
      : undefined;

  return valid(customerValuePercent);
}

export function validateDealEligibility(input: DealEligibilityInput): DealEligibilityResult {
  const appliesTo = normalizeAppliesTo(input.appliesTo);
  if (appliesTo === "ENTIRE_ORDER") {
    return invalid(
      "ENTIRE_ORDER_DISCOUNT_NOT_ALLOWED",
      "Twofer only supports free-item offers or at least 40% off a single item. Entire-order discounts are not eligible.",
    );
  }
  if (appliesTo === "SECOND_ITEM") {
    return invalid(
      "SECOND_ITEM_DISCOUNT_NOT_ALLOWED",
      "Twofer only supports free-item offers or at least 40% off a single item. Discounted second-item deals are not eligible.",
    );
  }

  const dealType = normalizeDealType(input.dealType);
  if (!dealType) {
    if (looksLikeSecondItemDiscount(input.dealType)) {
      return invalid(
        "SECOND_ITEM_DISCOUNT_NOT_ALLOWED",
        "Twofer only supports free-item offers or at least 40% off a single item. Discounted second-item deals are not eligible.",
      );
    }
    return invalid(
      "INVALID_DEAL_TYPE",
      "Twofer deals must be Buy One Get One Free, Buy One Get Something Free, or at least 40% off a single item.",
    );
  }

  if (dealType === "BUY_ONE_GET_ONE_FREE" || dealType === "BUY_ONE_GET_SOMETHING_FREE") {
    return validateFreeItemDeal(input, dealType);
  }

  const discountPercent = numeric(input.discountPercent);
  const fieldErrors: Record<string, string> = {};
  if (discountPercent == null) {
    fieldErrors.discountPercent = "Enter the discount percent.";
  } else if (discountPercent < MIN_CUSTOMER_VALUE_PERCENT) {
    return invalid(
      "DISCOUNT_TOO_LOW",
      `Your current deal is ${roundPercent(discountPercent)}% off, so it cannot be generated or published. Increase the discount to 40% or choose a free-item deal type to continue.`,
      undefined,
      discountPercent,
    );
  }

  if (!hasItem(input.itemId, input.itemDescription)) {
    fieldErrors.itemDescription = "Enter the single item this discount applies to.";
  }
  if (fieldErrors.discountPercent) {
    return invalid("DISCOUNT_TOO_LOW", "Enter a discount of at least 40% for one single item.", fieldErrors);
  }
  if (fieldErrors.itemDescription) {
    return invalid("MISSING_REQUIRED_ITEM", "Enter the single item this discount applies to.", fieldErrors);
  }

  return valid(discountPercent!);
}

export function dealEligibilityErrorPayload(result: DealEligibilityResult) {
  return {
    error: "DEAL_NOT_ELIGIBLE",
    reasonCode: result.reasonCode,
    message: result.message,
    customerValuePercent: result.customerValuePercent,
    fieldErrors: result.fieldErrors,
  };
}
