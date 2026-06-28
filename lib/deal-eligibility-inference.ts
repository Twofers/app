import {
  createDefaultDealEligibilityFormState,
  type DealEligibilityFormState,
} from "./deal-eligibility-form";

function cleanText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "")
    .trim();
}

function cleanItem(value: string): string {
  return cleanText(value)
    .replace(/\b(today|tonight|this afternoon|this morning|this evening|only|deal|offer)\b.*$/i, "")
    .replace(/\b(get|and get|with purchase)\b.*$/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .trim();
}

function withItemSeed(item: string): DealEligibilityFormState | null {
  const cleaned = cleanItem(item);
  if (!cleaned) return null;
  return createDefaultDealEligibilityFormState({
    requiredItemDescription: cleaned,
    freeItemDescription: cleaned,
  });
}

export function inferDealEligibilityFormFromText(text: string): DealEligibilityFormState | null {
  const source = cleanText(text);
  if (!source) return null;

  const bogoPrefix = source.match(/\b(?:bogo|2-for-1|two\s+for\s+one)\s+([^.!?,;]+)/i);
  if (bogoPrefix?.[1]) {
    const seeded = withItemSeed(bogoPrefix[1]);
    return seeded ? { ...seeded, dealType: "BUY_ONE_GET_ONE_FREE" } : null;
  }

  const buyOneGetFreeItem = source.match(
    /\bbuy\s+(?:one|1|a|an)\s+(.+?)\s*(?:,|\band\b)?\s*\bget\s+(?:one|1|a|an)?\s*free\s+([^.!?,;]+)/i,
  );
  if (buyOneGetFreeItem?.[1] && buyOneGetFreeItem[2]) {
    const requiredItem = cleanItem(buyOneGetFreeItem[1]);
    const freeItem = cleanItem(buyOneGetFreeItem[2]);
    if (requiredItem && freeItem) {
      return {
        ...createDefaultDealEligibilityFormState({
          requiredItemDescription: requiredItem,
          freeItemDescription: freeItem,
        }),
        dealType: "BUY_ONE_GET_SOMETHING_FREE",
      };
    }
  }

  const buyOneGetOneFree = source.match(
    /\bbuy\s+(?:one|1|a|an)\s+(.+?)\s*(?:,|\band\b)?\s*\bget\s+(?:one|1|a|an|the\s+next|the\s+second|another)?\s*(?:same\s+)?(?:one|item)?\s*(?:free|for\s+free)\b/i,
  );
  if (buyOneGetOneFree?.[1]) {
    const seeded = withItemSeed(buyOneGetOneFree[1]);
    return seeded ? { ...seeded, dealType: "BUY_ONE_GET_ONE_FREE" } : null;
  }

  const percentOff = source.match(/\b([4-9]\d|100)\s*%\s*(?:off|discount)\s+(?:one|a|an|the)?\s*([^.!?,;]+)/i);
  if (percentOff?.[1] && percentOff[2]) {
    const item = cleanItem(percentOff[2]);
    if (item) {
      return {
        ...createDefaultDealEligibilityFormState({ itemDescription: item }),
        dealType: "PERCENT_OFF_SINGLE_ITEM",
        discountPercent: percentOff[1],
      };
    }
  }

  return null;
}

function fillIfEmpty(current: string, inferred: string): string {
  return current.trim() ? current : inferred;
}

export function mergeInferredEligibilityForm(
  current: DealEligibilityFormState,
  inferred: DealEligibilityFormState | null,
  options: { allowDealTypeChange?: boolean } = {},
): DealEligibilityFormState {
  if (!inferred) return current;

  const dealType = options.allowDealTypeChange ? inferred.dealType : current.dealType;
  if (dealType === "PERCENT_OFF_SINGLE_ITEM") {
    const itemDescription =
      inferred.dealType === "PERCENT_OFF_SINGLE_ITEM" ? inferred.itemDescription : inferred.requiredItemDescription;
    return {
      ...current,
      dealType,
      discountPercent:
        inferred.dealType === "PERCENT_OFF_SINGLE_ITEM" && (!current.discountPercent.trim() || current.discountPercent === "40")
          ? inferred.discountPercent
          : current.discountPercent,
      itemDescription: fillIfEmpty(current.itemDescription, itemDescription),
    };
  }

  const sameItemFallback = inferred.requiredItemDescription || inferred.itemDescription;
  return {
    ...current,
    dealType,
    requiredItemDescription: fillIfEmpty(current.requiredItemDescription, sameItemFallback),
    freeItemDescription:
      dealType === "BUY_ONE_GET_ONE_FREE"
        ? fillIfEmpty(current.freeItemDescription, inferred.freeItemDescription || sameItemFallback)
        : fillIfEmpty(current.freeItemDescription, inferred.freeItemDescription),
  };
}
