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
    .replace(/\b(today|tonight|this afternoon|this morning|this evening|only|deal|offer|next hour|after\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b.*$/i, "")
    .replace(/\b(get|and get|with purchase|when you buy|with any purchase)\b.*$/i, "")
    .replace(/\s+(?:for\s+)?free$/i, "")
    .replace(/^(a|an|the|one|1)\s+/i, "")
    .replace(/^(free|complimentary)\s+/i, "")
    .trim();
}

function looksLikePlainItem(value: string): boolean {
  const clean = cleanItem(value);
  if (!clean) return false;
  if (/\b(?:bogo|buy|purchase|order|get|free|off|discount|percent|deal|offer|sale|valid|expires?)\b|%/i.test(value)) {
    return false;
  }
  return clean.split(/\s+/).length <= 7;
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

  const purchaseQuantity = "(?:one|1|a|an)";
  const freeQuantity = "(?:one|1|a|an)";

  const buyOneGetOneFreeTrailingItem = source.match(
    new RegExp(`\\bbuy\\s+${purchaseQuantity}\\s+get\\s+${freeQuantity}\\s+free\\s+([^.!?,;]+)`, "i"),
  );
  if (buyOneGetOneFreeTrailingItem?.[1]) {
    const seeded = withItemSeed(buyOneGetOneFreeTrailingItem[1]);
    return seeded ? { ...seeded, dealType: "BUY_ONE_GET_ONE_FREE" } : null;
  }

  const buyOneGetOneFreeSuffix = source.match(
    new RegExp(
      `\\bbuy\\s+${purchaseQuantity}\\s+get\\s+(?:${freeQuantity}\\s+)?(?:free\\s+)?([^.!?,;]+?)(?:\\s+(?:free|for\\s+free))?(?:\\s+[^.!?,;]*)?$`,
      "i",
    ),
  );
  if (buyOneGetOneFreeSuffix?.[1]) {
    const seeded = withItemSeed(buyOneGetOneFreeSuffix[1]);
    return seeded ? { ...seeded, dealType: "BUY_ONE_GET_ONE_FREE" } : null;
  }

  const buyOneGetFreeItem = source.match(
    new RegExp(
      `\\bbuy\\s+(?:${purchaseQuantity}\\s+)?(.+?)\\s*(?:,|\\band\\b)?\\s*\\bget\\s+(?:${freeQuantity}\\s+)?free\\s+([^.!?,;]+)`,
      "i",
    ),
  ) ?? source.match(
    new RegExp(
      `\\bbuy\\s+(?:${purchaseQuantity}\\s+)?(.+?)\\s*(?:,|\\band\\b)?\\s*\\bget\\s+(?:${freeQuantity}\\s+)?(.+?)\\s+(?:for\\s+)?free\\b(?:\\s+[^.!?,;]*)?`,
      "i",
    ),
  );
  if (buyOneGetFreeItem?.[1] && buyOneGetFreeItem[2]) {
    const requiredItem = cleanItem(buyOneGetFreeItem[1]);
    const freeItem = cleanItem(buyOneGetFreeItem[2]);
    const freeItemIsPronoun = /^(?:one|item|same|next|second|another)$/i.test(freeItem);
    if (requiredItem && freeItem && !freeItemIsPronoun) {
      return {
        ...createDefaultDealEligibilityFormState({
          requiredItemDescription: requiredItem,
          freeItemDescription: freeItem,
        }),
        dealType: "BUY_ONE_GET_SOMETHING_FREE",
      };
    }
  }

  const freeItemWithPurchase = source.match(
    /\b(?:free|complimentary)\s+(.+?)\s+(?:with|when\s+you\s+buy|after\s+buying|after\s+ordering)\s+(?:any\s+|a\s+|an\s+|one\s+|1\s+)?([^.!?,;]+)/i,
  ) ?? source.match(
    /\b(?:buy|order|purchase)\s+(?:any\s+|a\s+|an\s+|one\s+|1\s+)?(.+?)\s+(?:and\s+)?(?:the\s+)?(.+?)\s+(?:is|are)\s+on\s+us\b/i,
  );
  if (freeItemWithPurchase?.[1] && freeItemWithPurchase[2]) {
    const first = cleanItem(freeItemWithPurchase[1]);
    const second = cleanItem(freeItemWithPurchase[2]);
    const matchedOnUs = /\b(?:is|are)\s+on\s+us\b/i.test(source);
    const requiredItem = matchedOnUs ? first : second;
    const freeItem = matchedOnUs ? second : first;
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
    new RegExp(
      `\\bbuy\\s+(?:${purchaseQuantity}\\s+)?(.+?)\\s*(?:,|\\band\\b)?\\s*\\bget\\s+(?:${freeQuantity}|the\\s+next|the\\s+second|another)?\\s*(?:same\\s+)?(?:one|item)?\\s*(?:free|for\\s+free)\\b`,
      "i",
    ),
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

  if (looksLikePlainItem(source)) {
    const item = cleanItem(source);
    return {
      ...createDefaultDealEligibilityFormState({ itemDescription: item }),
      dealType: "PERCENT_OFF_SINGLE_ITEM",
    };
  }

  return null;
}

function fillIfEmpty(current: string, inferred: string): string {
  return current.trim() ? current : inferred;
}

function fillIfEmptyOrAuto(current: string, inferred: string, previousInferred?: string): string {
  if (!current.trim()) return inferred;
  if (previousInferred && current.trim() === previousInferred.trim()) return inferred;
  return current;
}

export function mergeInferredEligibilityForm(
  current: DealEligibilityFormState,
  inferred: DealEligibilityFormState | null,
  options: { allowDealTypeChange?: boolean; previousInferred?: DealEligibilityFormState | null } = {},
): DealEligibilityFormState {
  if (!inferred) return current;

  const previous = options.previousInferred ?? null;
  const canChangeDealType =
    options.allowDealTypeChange &&
    (!previous || current.dealType === previous.dealType || current.dealType === createDefaultDealEligibilityFormState().dealType);
  const dealType = canChangeDealType ? inferred.dealType : current.dealType;
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
      itemDescription: fillIfEmptyOrAuto(current.itemDescription, itemDescription, previous?.itemDescription),
    };
  }

  const sameItemFallback = inferred.requiredItemDescription || inferred.itemDescription;
  return {
    ...current,
    dealType,
    requiredItemDescription: fillIfEmptyOrAuto(
      current.requiredItemDescription,
      sameItemFallback,
      previous?.requiredItemDescription || previous?.itemDescription,
    ),
    freeItemDescription:
      dealType === "BUY_ONE_GET_ONE_FREE"
        ? fillIfEmptyOrAuto(
            current.freeItemDescription,
            inferred.freeItemDescription || sameItemFallback,
            previous?.freeItemDescription || previous?.requiredItemDescription || previous?.itemDescription,
          )
        : fillIfEmptyOrAuto(current.freeItemDescription, inferred.freeItemDescription, previous?.freeItemDescription),
  };
}
