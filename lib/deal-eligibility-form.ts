import {
  type DealEligibilityDealType,
  type DealEligibilityInput,
  type DealEligibilityResult,
} from "./deal-eligibility";

export type DealEligibilityFormState = {
  dealType: DealEligibilityDealType;
  discountPercent: string;
  itemDescription: string;
  itemRetailValue: string;
  requiredItemDescription: string;
  requiredItemRetailValue: string;
  freeItemDescription: string;
  freeItemRetailValue: string;
};

export const DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS = [
  "deal_status",
  "eligibility_status",
  "eligibility_reason_code",
  "eligibility_message",
  "customer_value_percent",
  "deal_type",
  "applies_to",
  "discount_percent",
  "required_purchase_quantity",
  "free_item_quantity",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_description",
  "free_item_retail_value_cents",
  "free_item_discount_percent",
  "item_description",
  "item_retail_value_cents",
] as const;

export type DealEligibilityDealColumnKey = (typeof DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS)[number];

export function createDefaultDealEligibilityFormState(
  seed?: Partial<Pick<DealEligibilityFormState, "itemDescription" | "requiredItemDescription" | "freeItemDescription">>,
): DealEligibilityFormState {
  return {
    dealType: "PERCENT_OFF_SINGLE_ITEM",
    discountPercent: "40",
    itemDescription: seed?.itemDescription ?? "",
    itemRetailValue: "",
    requiredItemDescription: seed?.requiredItemDescription ?? "",
    requiredItemRetailValue: "",
    freeItemDescription: seed?.freeItemDescription ?? "",
    freeItemRetailValue: "",
  };
}

function dollarsToCents(value: string): number | null {
  const clean = value.replace(/[$,\s]/g, "").trim();
  if (!clean) return null;
  const n = Number(clean);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function centsToDollarsText(value: unknown): string {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return "";
  return (Math.round(n) / 100).toFixed(2).replace(/\.00$/, "");
}

function clean(value: string): string {
  return value.trim();
}

export function dealEligibilityFormToInput(form: DealEligibilityFormState): DealEligibilityInput {
  if (form.dealType === "PERCENT_OFF_SINGLE_ITEM") {
    return {
      dealType: form.dealType,
      appliesTo: "SINGLE_ITEM",
      discountPercent: clean(form.discountPercent),
      itemDescription: clean(form.itemDescription),
      itemRetailValueCents: dollarsToCents(form.itemRetailValue),
    };
  }

  const requiredItemDescription = clean(form.requiredItemDescription);
  const freeItemDescription =
    form.dealType === "BUY_ONE_GET_ONE_FREE"
      ? clean(form.freeItemDescription) || requiredItemDescription
      : clean(form.freeItemDescription);

  return {
    dealType: form.dealType,
    appliesTo: "SINGLE_ITEM",
    requiredPurchaseQuantity: 1,
    freeItemQuantity: 1,
    requiredItemDescription,
    requiredItemRetailValueCents: dollarsToCents(form.requiredItemRetailValue),
    freeItemDescription,
    freeItemRetailValueCents: dollarsToCents(form.freeItemRetailValue),
    freeItemDiscountPercent: 100,
  };
}

export function dealEligibilityFormToDealColumns(
  form: DealEligibilityFormState,
  result: DealEligibilityResult,
  dealStatus: "DRAFT_INVALID" | "LIVE" | "READY" = result.eligible ? "LIVE" : "DRAFT_INVALID",
): Record<DealEligibilityDealColumnKey, unknown> {
  const input = dealEligibilityFormToInput(form);
  return {
    deal_status: dealStatus,
    eligibility_status: result.eligibilityStatus,
    eligibility_reason_code: result.reasonCode ?? null,
    eligibility_message: result.message ?? null,
    customer_value_percent: result.customerValuePercent ?? null,
    deal_type: form.dealType,
    applies_to: input.appliesTo ?? "SINGLE_ITEM",
    discount_percent: input.discountPercent ?? null,
    required_purchase_quantity: input.requiredPurchaseQuantity ?? null,
    free_item_quantity: input.freeItemQuantity ?? null,
    required_item_description: input.requiredItemDescription ?? null,
    required_item_retail_value_cents: input.requiredItemRetailValueCents ?? null,
    free_item_description: input.freeItemDescription ?? null,
    free_item_retail_value_cents: input.freeItemRetailValueCents ?? null,
    free_item_discount_percent: input.freeItemDiscountPercent ?? null,
    item_description: input.itemDescription ?? null,
    item_retail_value_cents: input.itemRetailValueCents ?? null,
  };
}

export function dealEligibilityFormFromDealRow(row: Record<string, unknown>): DealEligibilityFormState {
  const rawType = typeof row.deal_type === "string" ? row.deal_type : "";
  const dealType: DealEligibilityDealType =
    rawType === "BUY_ONE_GET_ONE_FREE" ||
    rawType === "BUY_ONE_GET_SOMETHING_FREE" ||
    rawType === "PERCENT_OFF_SINGLE_ITEM"
      ? rawType
      : "PERCENT_OFF_SINGLE_ITEM";

  return {
    dealType,
    discountPercent: row.discount_percent != null ? String(row.discount_percent) : "40",
    itemDescription: typeof row.item_description === "string" ? row.item_description : "",
    itemRetailValue: centsToDollarsText(row.item_retail_value_cents),
    requiredItemDescription:
      typeof row.required_item_description === "string" ? row.required_item_description : "",
    requiredItemRetailValue: centsToDollarsText(row.required_item_retail_value_cents),
    freeItemDescription: typeof row.free_item_description === "string" ? row.free_item_description : "",
    freeItemRetailValue: centsToDollarsText(row.free_item_retail_value_cents),
  };
}

export function omitDealEligibilityColumns<T extends Record<string, unknown>>(row: T) {
  const next = { ...row };
  for (const key of DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS) {
    delete next[key];
  }
  return next;
}
