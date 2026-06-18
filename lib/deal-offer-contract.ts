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
  headline_alternative?: string;
  push_title?: string;
  push_body?: string;
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
  fallback_reason?: string;
  generator_version: string;
};

export const AI_COPY_GENERATOR_VERSION = "ai-copy-v2";

export const DEAL_COPY_LIMITS = {
  headline: 96,
  description: 180,
  pushTitle: 64,
  pushBody: 120,
  socialCaption: 220,
  terms: 240,
} as const;

export type NormalizedDealFacts = {
  merchantName: string;
  buyQuantity?: number;
  buyItem?: string;
  rewardQuantity?: number;
  rewardItem?: string;
  rewardType: "free" | "percent_off";
  rewardValue?: number;
  eligibility?: string;
  variantRestrictions?: string;
  startTime?: string;
  endTime?: string;
  claimLimit?: number;
  tonePreference?: string;
};

export type DeterministicDealChannelCopy = {
  headline: string;
  description: string;
  pushTitle: string;
  pushBody: string;
  socialCaption: string;
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

export type StructuredOffer = DealOfferContract;

export type CanonicalizedItem = {
  original: string;
  canonical: string;
  confidence: "high" | "medium" | "low";
  source: "menu_catalog" | "known_food_dictionary" | "spellcheck" | "unchanged";
};

const KNOWN_FOOD_ITEM_CANONICALS: Record<string, string> = {
  bagle: "bagel",
  bagles: "bagel",
  bagel: "bagel",
  bagels: "bagel",
  coffee: "coffee",
  coffees: "coffee",
  latte: "latte",
  lattes: "latte",
  cappuccino: "cappuccino",
  cappuccinos: "cappuccino",
  croissant: "croissant",
  croissants: "croissant",
  sandwich: "sandwich",
  sandwiches: "sandwich",
  pastry: "pastry",
  pastries: "pastry",
  taco: "taco",
  tacos: "taco",
  dessert: "dessert",
  desserts: "dessert",
  entree: "entree",
  entrees: "entree",
  drink: "drink",
  drinks: "drink",
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeItemKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeOfferItem(
  original: string,
  menuCatalogNames: readonly string[] = [],
): CanonicalizedItem {
  const clean = cleanText(original);
  if (!clean) {
    return { original: "", canonical: "", confidence: "low", source: "unchanged" };
  }

  const cleanKey = normalizeItemKey(clean);
  const catalogMatch = menuCatalogNames.find((name) => normalizeItemKey(name) === cleanKey);
  if (catalogMatch) {
    return {
      original: clean,
      canonical: cleanText(catalogMatch),
      confidence: "high",
      source: "menu_catalog",
    };
  }

  const known = KNOWN_FOOD_ITEM_CANONICALS[cleanKey];
  if (known) {
    return {
      original: clean,
      canonical: known,
      confidence: cleanKey === known ? "medium" : "high",
      source: "known_food_dictionary",
    };
  }

  return { original: clean, canonical: clean, confidence: "low", source: "unchanged" };
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

function stripEndingPunctuation(value: string): string {
  return cleanText(value).replace(/[.!?]+$/g, "");
}

const SMALL_NUMBER_WORDS: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
};

const QUANTITY_PREFIXES = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "single",
  "double",
  "triple",
  "half-dozen",
  "half dozen",
  "dozen",
];

function numberWord(value: number): string {
  return SMALL_NUMBER_WORDS[value] ?? String(value);
}

function lowerFirst(value: string): string {
  const clean = cleanText(value);
  if (!clean) return "";
  if (/^[A-Z]{2,}\b/.test(clean)) return clean;
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(clean)) return clean;
  return `${clean.charAt(0).toLowerCase()}${clean.slice(1)}`;
}

function startsWithArticle(value: string): boolean {
  return /^(?:a|an|the)\s+/i.test(cleanText(value));
}

function stripLeadingArticle(value: string): string {
  return cleanText(value).replace(/^(?:a|an|the)\s+/i, "");
}

function startsWithQuantityPhrase(value: string): boolean {
  const clean = cleanText(value).toLowerCase();
  if (!clean) return false;
  if (/^\d+\s*[-]?\s*(?:pack|ct|count|piece|pc|dozen)\b/.test(clean)) return true;
  return QUANTITY_PREFIXES.some((prefix) => clean === prefix || clean.startsWith(`${prefix} `) || clean.startsWith(`${prefix}-`));
}

function articleFor(nounPhrase: string): "a" | "an" {
  const clean = stripLeadingArticle(nounPhrase).trim();
  if (!clean) return "a";
  if (/^(?:honest|hour|heir|herb)\b/i.test(clean)) return "an";
  if (/^(?:uni([^nmd]|$)|user|useful|utensil|u[bcfhjkqrst][a-z])/i.test(clean)) return "a";
  return /^[aeiou]/i.test(clean) ? "an" : "a";
}

function pluralizeWord(word: string): string {
  if (!word) return word;
  if (/[^A-Za-z]$/.test(word)) return word;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/fe$/i.test(word)) return `${word.slice(0, -2)}ves`;
  if (/f$/i.test(word)) return `${word.slice(0, -1)}ves`;
  return `${word}s`;
}

function pluralizeItemPhrase(itemName: string): string {
  const clean = stripLeadingArticle(itemName);
  const match = clean.match(/([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/);
  if (!match) return clean;
  const [full, word, suffix] = match;
  if (/s$/i.test(word) && !/(?:ss|us)$/i.test(word)) return clean;
  return `${clean.slice(0, clean.length - full.length)}${pluralizeWord(word)}${suffix}`;
}

function looksPluralLike(itemName: string): boolean {
  const clean = stripLeadingArticle(itemName).toLowerCase();
  const lastWord = clean.match(/[a-z][a-z'-]*$/)?.[0] ?? "";
  return Boolean(lastWord && /s$/.test(lastWord) && !/(?:ss|us)$/.test(lastWord));
}

function formatPurchasePhrase(quantity: number, itemName: string): string {
  const item = cleanText(itemName);
  if (!item) return "";
  if (quantity === 1) {
    if (startsWithArticle(item) || startsWithQuantityPhrase(item)) return lowerFirst(item);
    return `${articleFor(item)} ${lowerFirst(item)}`;
  }
  return `${numberWord(quantity)} ${pluralizeItemPhrase(item)}`;
}

function formatCountedItem(quantity: number, itemName: string): string {
  const item = stripLeadingArticle(itemName);
  if (!item) return "";
  if (quantity === 1) {
    if (startsWithQuantityPhrase(item)) return lowerFirst(item);
    return `one ${lowerFirst(item)}`;
  }
  return `${numberWord(quantity)} ${pluralizeItemPhrase(item)}`;
}

function formatFreeRewardPhrase(quantity: number, itemName: string): string {
  const item = cleanText(itemName);
  if (!item) return "";
  if (quantity === 1) {
    if (startsWithArticle(item) || startsWithQuantityPhrase(item)) return `${lowerFirst(item)} free`;
    if (looksPluralLike(item)) return `free ${lowerFirst(stripLeadingArticle(item))}`;
    return `a free ${lowerFirst(item)}`;
  }
  return `${numberWord(quantity)} free ${pluralizeItemPhrase(item)}`;
}

function normalizeItemForComparison(value: string): string {
  const clean = stripLeadingArticle(value)
    .toLowerCase()
    .replace(/[â€™']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (KNOWN_FOOD_ITEM_CANONICALS[clean]) return KNOWN_FOOD_ITEM_CANONICALS[clean];
  return clean.replace(/ies\b/g, "y").replace(/(?:ches|shes|xes|zes|ses)\b/g, (m) => m.slice(0, -2)).replace(/s\b/g, "");
}

function sameOfferItem(a: string, b: string): boolean {
  const left = normalizeItemForComparison(a);
  const right = normalizeItemForComparison(b);
  return Boolean(left && right && left === right);
}

function compactText(value: string, max: number): string {
  const clean = cleanText(value);
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max + 1);
  const lastSpace = clipped.search(/\s+\S*$/);
  if (lastSpace > Math.max(16, Math.floor(max * 0.65))) {
    return clipped.slice(0, lastSpace).trimEnd();
  }
  return clean.slice(0, max).trimEnd();
}

export function buildCanonicalHeadlineFromFacts(facts: NormalizedDealFacts): string {
  if (facts.rewardType === "free") {
    const buyItem = cleanText(facts.buyItem);
    const rewardItem = cleanText(facts.rewardItem);
    if (!buyItem || !rewardItem) return "Limited-time local offer";
    const buyQuantity = Math.max(1, Math.floor(facts.buyQuantity ?? 1));
    const rewardQuantity = Math.max(1, Math.floor(facts.rewardQuantity ?? 1));
    if (sameOfferItem(buyItem, rewardItem)) {
      const rewardPhrase = rewardQuantity === 1 ? "one free" : `${numberWord(rewardQuantity)} free`;
      return `Buy ${formatCountedItem(buyQuantity, buyItem)} and get ${rewardPhrase}`;
    }
    return `Buy ${formatPurchasePhrase(buyQuantity, buyItem)} and get ${formatFreeRewardPhrase(rewardQuantity, rewardItem)}`;
  }

  const item = cleanText(facts.buyItem);
  const value = facts.rewardValue;
  if (item && typeof value === "number" && Number.isFinite(value)) {
    return `Get ${Math.round(value)}% off one ${lowerFirst(stripLeadingArticle(item))}`;
  }
  return "Limited-time local offer";
}

export function normalizeDealFactsFromContract(contract: DealOfferContract): NormalizedDealFacts {
  if (contract.dealType === "PERCENT_OFF_SINGLE_ITEM") {
    return {
      merchantName: contract.businessName,
      buyQuantity: 1,
      buyItem: contract.singleItemDiscount?.itemName,
      rewardType: "percent_off",
      rewardValue: contract.singleItemDiscount?.discountPercent,
      eligibility: contract.canonicalShortTerms,
      startTime: contract.activeWindow?.humanReadable,
      claimLimit: contract.quantityLimit?.totalAvailable,
    };
  }

  return {
    merchantName: contract.businessName,
    buyQuantity: contract.requiredPurchase?.quantity ?? 1,
    buyItem: contract.requiredPurchase?.itemName,
    rewardQuantity: contract.freeReward?.quantity ?? 1,
    rewardItem: contract.freeReward?.itemName,
    rewardType: "free",
    eligibility: contract.canonicalShortTerms,
    startTime: contract.activeWindow?.humanReadable,
    claimLimit: contract.quantityLimit?.totalAvailable,
  };
}

function deterministicDescriptionForFacts(facts: NormalizedDealFacts): string {
  if (facts.rewardType === "percent_off") {
    const item = cleanText(facts.buyItem);
    const value = facts.rewardValue;
    if (item && typeof value === "number" && Number.isFinite(value)) {
      return `The ${Math.round(value)}% discount applies to one ${lowerFirst(stripLeadingArticle(item))}.`;
    }
    return "Review the offer details before publishing.";
  }

  const buyItem = cleanText(facts.buyItem);
  const rewardItem = cleanText(facts.rewardItem);
  if (!buyItem || !rewardItem) return "Review the offer details before publishing.";
  if (sameOfferItem(buyItem, rewardItem)) {
    return `Buy the first ${lowerFirst(stripLeadingArticle(buyItem))}; the next one is free.`;
  }
  return `The free ${lowerFirst(stripLeadingArticle(rewardItem))} is included after the qualifying ${lowerFirst(stripLeadingArticle(buyItem))} purchase.`;
}

export function buildDeterministicDealChannelCopy(contract: DealOfferContract): DeterministicDealChannelCopy {
  const facts = normalizeDealFactsFromContract(contract);
  const headline = buildCanonicalHeadlineFromFacts(facts);
  const description = compactText(deterministicDescriptionForFacts(facts), DEAL_COPY_LIMITS.description);
  const pushTitle =
    facts.rewardType === "free" && facts.buyItem && facts.rewardItem && !sameOfferItem(facts.buyItem, facts.rewardItem)
      ? compactText(`Free ${lowerFirst(stripLeadingArticle(facts.rewardItem))} with ${lowerFirst(stripLeadingArticle(facts.buyItem))}`, DEAL_COPY_LIMITS.pushTitle)
      : compactText(headline, DEAL_COPY_LIMITS.pushTitle);
  const timing = facts.startTime ? " Check the app for the live window." : "";
  const quantity = facts.claimLimit ? " Claims are limited." : "";
  const pushBody = compactText(`${headline}.${timing}${quantity}`.replace(/\s+/g, " "), DEAL_COPY_LIMITS.pushBody);
  return {
    headline,
    description,
    pushTitle,
    pushBody,
    socialCaption: compactText(`${headline}. ${description}`, DEAL_COPY_LIMITS.socialCaption),
  };
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
    const requiredItem = canonicalizeOfferItem(cleanText(params.dealEligibility.requiredItemDescription)).canonical;
    const freeItem =
      dealType === "BUY_ONE_GET_ONE_FREE"
        ? canonicalizeOfferItem(cleanText(params.dealEligibility.freeItemDescription)).canonical || requiredItem
        : canonicalizeOfferItem(cleanText(params.dealEligibility.freeItemDescription)).canonical;
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
    const canonicalFacts: NormalizedDealFacts = {
      merchantName: businessName,
      buyQuantity: requiredQuantity,
      buyItem: requiredItem,
      rewardQuantity: freeQuantity,
      rewardItem: freeItem,
      rewardType: "free",
      startTime: params.activeWindowHumanReadable ?? undefined,
      claimLimit: quantityLimit ?? undefined,
    };
    const canonicalOfferLine = buildCanonicalHeadlineFromFacts(canonicalFacts);
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
          : [canonicalOfferLine, `get a free ${freeItem}`],
        doNotChangeMechanics: true,
      },
    };
  }

  if (dealType === "PERCENT_OFF_SINGLE_ITEM") {
    const itemName = canonicalizeOfferItem(cleanText(params.dealEligibility.itemDescription)).canonical;
    const discountPercent = Math.round(numeric(params.dealEligibility.discountPercent) ?? 0);
    if (!itemName || discountPercent < 40) return null;

    const canonicalOfferLine = buildCanonicalHeadlineFromFacts({
      merchantName: businessName,
      buyQuantity: 1,
      buyItem: itemName,
      rewardType: "percent_off",
      rewardValue: discountPercent,
      startTime: params.activeWindowHumanReadable ?? undefined,
      claimLimit: quantityLimit ?? undefined,
    });
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
    copy.push_title,
    copy.push_notification,
    copy.push_body,
    copy.social_caption,
    copy.terms_summary,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

function containsMetadataLeak(text: string): boolean {
  if (/\b\d{5}(?:-\d{4})?\b/.test(text)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(text)) return true;
  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text)) return true;
  if (/\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(text)) return true;
  if (/\b\d+\s+available\b/i.test(text)) return true;
  if (/\bavailable\s+(?:from|until|through|between)\b/i.test(text)) return true;
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateShape(copy: Partial<AiDealCopyVariant>, reasonCodes: string[]): void {
  if (!isNonEmptyString(copy.headline)) reasonCodes.push("EMPTY_HEADLINE");
  if (!isNonEmptyString(copy.short_description)) reasonCodes.push("EMPTY_SHORT_DESCRIPTION");
  if (!isNonEmptyString(copy.push_notification)) reasonCodes.push("EMPTY_PUSH_NOTIFICATION");
  if (isNonEmptyString(copy.headline) && copy.headline.trim().length > DEAL_COPY_LIMITS.headline) reasonCodes.push("HEADLINE_TOO_LONG");
  if (isNonEmptyString(copy.short_description) && copy.short_description.trim().length > DEAL_COPY_LIMITS.description) {
    reasonCodes.push("SHORT_DESCRIPTION_TOO_LONG");
  }
  if (isNonEmptyString(copy.push_notification) && copy.push_notification.trim().length > DEAL_COPY_LIMITS.pushBody) {
    reasonCodes.push("PUSH_NOTIFICATION_TOO_LONG");
  }
  if (copy.push_title != null && (!isNonEmptyString(copy.push_title) || copy.push_title.trim().length > DEAL_COPY_LIMITS.pushTitle)) {
    reasonCodes.push("PUSH_TITLE_INVALID");
  }
  if (copy.social_caption != null && (!isNonEmptyString(copy.social_caption) || copy.social_caption.trim().length > DEAL_COPY_LIMITS.socialCaption)) {
    reasonCodes.push("SOCIAL_CAPTION_INVALID");
  }
}

function normalizedCopyField(value: string | null | undefined): string {
  return cleanText(value ?? "")
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function containsCopySyntaxLeak(text: string): boolean {
  if (/```|[*_`#]|^\s*[-*]\s+/m.test(text)) return true;
  if (/[{}[\]]/.test(text)) return true;
  if (/(?:^|\s)(?:headline|description|push\s*title|push\s*body|json)\s*:/i.test(text)) return true;
  if (/["“”]/.test(text)) return true;
  return false;
}

function containsUnsupportedPrice(text: string): boolean {
  return /\$\s*\d|\b\d+(?:\.\d{2})?\s+dollars?\b|\b\d+(?:\.\d{2})?\s+bucks?\b/i.test(text);
}

function validateGeneralCopyQuality(copy: Partial<AiDealCopyVariant>, reasonCodes: string[]): void {
  const headline = cleanText(copy.headline);
  const description = cleanText(copy.short_description);
  const push = cleanText(copy.push_notification);
  const social = cleanText(copy.social_caption);
  const text = copyText(copy);

  if (headline && /[.!?]$/.test(headline)) reasonCodes.push("HEADLINE_TRAILING_PUNCTUATION");
  if (headline && /\bwith\s+(?:a\s+|an\s+|one\s+)?free\b/i.test(headline)) reasonCodes.push("HEADLINE_WITH_FREE_FRAGMENT");
  if (headline && !/^(?:buy|get|order|save|claim)\b/i.test(headline)) reasonCodes.push("HEADLINE_DOES_NOT_START_WITH_ACTION");
  if (containsCopySyntaxLeak(text)) reasonCodes.push("COPY_SYNTAX_LEAK");
  if (containsUnsupportedPrice(text)) reasonCodes.push("UNSUPPORTED_PRICE");
  if (/\b(?:delicious|fresh|best|artisan|amazing|incredible|ultimate|perfect)\b/i.test(text)) {
    reasonCodes.push("UNSUPPORTED_PROMO_CLAIM");
  }

  const normalizedHeadline = normalizedCopyField(headline);
  const normalizedDescription = normalizedCopyField(description);
  const normalizedPush = normalizedCopyField(push);
  const normalizedSocial = normalizedCopyField(social);
  if (normalizedHeadline && normalizedHeadline === normalizedDescription) reasonCodes.push("DUPLICATE_HEADLINE_DESCRIPTION");
  if (normalizedDescription && normalizedDescription === normalizedPush) reasonCodes.push("DUPLICATE_DESCRIPTION_PUSH");
  if (normalizedHeadline && normalizedHeadline === normalizedSocial) reasonCodes.push("DUPLICATE_HEADLINE_SOCIAL");
}

function validateBuyOneGetSomethingFree(
  text: string,
  contract: DealOfferContract,
  reasonCodes: string[],
): void {
  const required = contract.requiredPurchase?.itemName ?? "";
  const free = contract.freeReward?.itemName ?? "";
  const requiredQuantity = contract.requiredPurchase?.quantity ?? 1;
  const freeQuantity = contract.freeReward?.quantity ?? 1;
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
  if (
    requiredQuantity === 1 &&
    new RegExp(`\\bbuy\\s+(?:two|2|three|3|four|4|five|5)\\s+${requiredPattern}s?\\b`).test(normalized)
  ) {
    reasonCodes.push("REQUIRED_QUANTITY_CHANGED");
  }
  if (
    freeQuantity === 1 &&
    new RegExp(`\\b(?:two|2|three|3|four|4|five|5)\\s+free\\s+${freePattern}s?\\b`).test(normalized)
  ) {
    reasonCodes.push("FREE_QUANTITY_CHANGED");
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
  validateGeneralCopyQuality(copy, reasonCodes);

  const text = copyText(copy);
  if (containsMetadataLeak(text)) reasonCodes.push("COPY_CONTAINS_METADATA");
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

export function buildOfferCopyCandidates(contract: DealOfferContract): string[] {
  const deterministic = buildDeterministicDealChannelCopy(contract);
  if (contract.dealType === "BUY_ONE_GET_SOMETHING_FREE") {
    const required = contract.requiredPurchase?.itemName ?? "item";
    const free = contract.freeReward?.itemName ?? "item";
    return [
      sentence(deterministic.headline),
      deterministic.description,
      `The ${free} is free with the qualifying ${required} purchase.`,
    ];
  }

  if (contract.dealType === "BUY_ONE_GET_ONE_FREE") {
    const item = contract.requiredPurchase?.itemName ?? contract.freeReward?.itemName ?? "item";
    return [
      sentence(deterministic.headline),
      deterministic.description,
      `The second ${item} is free with the qualifying purchase.`,
    ];
  }

  const item = contract.singleItemDiscount?.itemName ?? "item";
  const discount = contract.singleItemDiscount?.discountPercent ?? 40;
  return [
    `Get ${discount}% off one ${item}.`,
    `Save ${discount}% on one ${item}.`,
  ];
}

export function buildHeadlineCandidates(contract: DealOfferContract): string[] {
  const deterministic = buildDeterministicDealChannelCopy(contract);
  if (contract.dealType === "BUY_ONE_GET_SOMETHING_FREE") {
    const required = contract.requiredPurchase?.itemName ?? "item";
    const free = contract.freeReward?.itemName ?? "item";
    return [
      deterministic.headline,
      `Get a free ${free} with ${formatPurchasePhrase(contract.requiredPurchase?.quantity ?? 1, required)}`,
      `Claim ${formatFreeRewardPhrase(contract.freeReward?.quantity ?? 1, free)} with ${lowerFirst(stripLeadingArticle(required))}`,
    ];
  }

  if (contract.dealType === "BUY_ONE_GET_ONE_FREE") {
    const item = contract.requiredPurchase?.itemName ?? contract.freeReward?.itemName ?? "item";
    return [
      deterministic.headline,
      `Get the next ${item} free`,
      `Claim a second ${item} free`,
    ];
  }

  const item = contract.singleItemDiscount?.itemName ?? "item";
  const discount = contract.singleItemDiscount?.discountPercent ?? 40;
  return [
    `${discount}% off ${item}`,
    `Save ${discount}% on ${item}`,
  ];
}

export function buildRequiredVisualItems(contract: DealOfferContract): string[] {
  const items =
    contract.dealType === "PERCENT_OFF_SINGLE_ITEM"
      ? [contract.singleItemDiscount?.itemName]
      : [contract.requiredPurchase?.itemName, contract.freeReward?.itemName];
  return [...new Set(items.filter((item): item is string => cleanText(item).length > 0).map(cleanText))];
}

function cleanVariant(copy: Partial<AiDealCopyVariant>): AiDealCopyVariant {
  const raw = copy as Partial<AiDealCopyVariant> & {
    headlineAlternative?: unknown;
    description?: unknown;
    pushTitle?: unknown;
    pushBody?: unknown;
    socialCaption?: unknown;
  };
  const headlineAlternative =
    typeof raw.headlineAlternative === "string" ? raw.headlineAlternative : copy.headline_alternative;
  const description = typeof raw.description === "string" ? raw.description : copy.short_description;
  const pushTitle = typeof raw.pushTitle === "string" ? raw.pushTitle : copy.push_title;
  const pushBody =
    typeof raw.pushBody === "string"
      ? raw.pushBody
      : copy.push_body ?? copy.push_notification;
  const socialCaption =
    typeof raw.socialCaption === "string"
      ? raw.socialCaption
      : copy.social_caption;
  return {
    headline: compactText(cleanText(headlineAlternative ?? copy.headline), DEAL_COPY_LIMITS.headline),
    short_description: compactText(cleanText(description), DEAL_COPY_LIMITS.description),
    push_notification: compactText(cleanText(pushBody), DEAL_COPY_LIMITS.pushBody),
    ...(isNonEmptyString(headlineAlternative) ? { headline_alternative: compactText(headlineAlternative, DEAL_COPY_LIMITS.headline) } : {}),
    ...(isNonEmptyString(pushTitle) ? { push_title: compactText(pushTitle, DEAL_COPY_LIMITS.pushTitle) } : {}),
    ...(isNonEmptyString(pushBody) ? { push_body: compactText(pushBody, DEAL_COPY_LIMITS.pushBody) } : {}),
    ...(isNonEmptyString(socialCaption) ? { social_caption: compactText(socialCaption, DEAL_COPY_LIMITS.socialCaption) } : {}),
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
  const deterministic = buildDeterministicDealChannelCopy(contract);

  if (contract.dealType === "BUY_ONE_GET_SOMETHING_FREE") {
    return cleanVariant({
      headline: deterministic.headline,
      short_description: deterministic.description,
      push_title: deterministic.pushTitle,
      push_notification: deterministic.pushBody,
      push_body: deterministic.pushBody,
      social_caption: deterministic.socialCaption,
    });
  }
  if (contract.dealType === "BUY_ONE_GET_ONE_FREE") {
    return cleanVariant({
      headline: deterministic.headline,
      short_description: deterministic.description,
      push_title: deterministic.pushTitle,
      push_notification: deterministic.pushBody,
      push_body: deterministic.pushBody,
      social_caption: deterministic.socialCaption,
    });
  }
  return cleanVariant({
    headline: deterministic.headline,
    short_description: deterministic.description,
    push_title: deterministic.pushTitle,
    push_notification: deterministic.pushBody,
    push_body: deterministic.pushBody,
    social_caption: deterministic.socialCaption,
  });
}

function lockCopy(
  copy: AiDealCopyVariant,
  contract: DealOfferContract,
  source: AiDealCopySource,
  variantCount: number,
  selectedVariantIndex: number | null,
  validationReasonCodes: string[],
  fallbackReason?: string,
): ValidatedDealCopy {
  const clean = cleanVariant(copy);
  const deterministic = buildDeterministicDealChannelCopy(contract);
  return {
    ...clean,
    headline: deterministic.headline,
    push_title: clean.push_title || deterministic.pushTitle,
    push_body: clean.push_body || clean.push_notification || deterministic.pushBody,
    push_notification: clean.push_body || clean.push_notification || deterministic.pushBody,
    terms_summary: contract.canonicalShortTerms,
    locked_offer_line: contract.canonicalOfferLine,
    locked_terms_line: contract.canonicalShortTerms,
    copy_source: source,
    variant_count: variantCount,
    selected_variant_index: selectedVariantIndex,
    validation_reason_codes: [...new Set(validationReasonCodes)],
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
    generator_version: AI_COPY_GENERATOR_VERSION,
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
  let firstVariants: AiDealCopyVariant[];
  try {
    firstVariants = await params.requestCopy({ attemptNumber: 1 });
  } catch (err) {
    const reasonCodes = ["MODEL_REQUEST_FAILED"];
    await params.logValidationFailure?.({ attemptNumber: 1, reasonCodes });
    const fallback = deterministicFallbackCopy(params.contract);
    return lockCopy(
      fallback,
      params.contract,
      "DETERMINISTIC_FALLBACK",
      0,
      null,
      reasonCodes,
      `MODEL_REQUEST_FAILED:${String(err).slice(0, 80)}`,
    );
  }
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

  let secondVariants: AiDealCopyVariant[];
  try {
    secondVariants = await params.requestCopy({
      attemptNumber: 2,
      validationFeedback: feedbackFor(firstSelection.reasonCodes, params.contract),
    });
  } catch (err) {
    const reasonCodes = [...firstSelection.reasonCodes, "MODEL_RETRY_FAILED"];
    await params.logValidationFailure?.({ attemptNumber: 2, reasonCodes });
    const fallback = deterministicFallbackCopy(params.contract);
    return lockCopy(
      fallback,
      params.contract,
      "DETERMINISTIC_FALLBACK",
      firstVariants.length,
      null,
      reasonCodes,
      `MODEL_RETRY_FAILED:${String(err).slice(0, 80)}`,
    );
  }
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
    secondSelection.reasonCodes.length ? secondSelection.reasonCodes.join(",") : "NO_VALID_AI_COPY",
  );
}
