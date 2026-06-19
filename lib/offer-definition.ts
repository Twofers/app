import {
  buildDealOfferContract,
  type DealOfferContract,
} from "./deal-offer-contract";
import type {
  DealEligibilityInput,
  DealEligibilityResult,
} from "./deal-eligibility";

export type OfferDefinitionV1OfferType =
  | "buy_one_get_one"
  | "buy_one_get_reward_item"
  | "percent_off_single_item";

export type OfferDefinitionV1Schedule = {
  mode: "one_time" | "recurring" | "summary_only";
  summary: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string | null;
  daysOfWeek: number[] | null;
  windowStartMinutes: number | null;
  windowEndMinutes: number | null;
};

export type OfferDefinitionV1Item = {
  catalogItemId: string | null;
  displayName: string;
  quantity: number;
  verifiedAttributes: string[];
};

export type OfferDefinitionV1Reward =
  | {
      rule: "same_item_free" | "reward_item_free";
      discountPercent: 100;
      quantity: number;
      catalogItemIds: string[];
      displayNames: string[];
    }
  | {
      rule: "percent_off_single_item";
      discountPercent: number;
      quantity: 1;
      catalogItemIds: string[];
      displayNames: string[];
    };

export type OfferDefinitionV1Redemption = {
  exactLocationOnly: true;
  redeemAtBusinessName: string;
  redeemAtLocationName: string;
  claimCutoffSummary: string | null;
};

export type OfferDefinitionV1DisclosureId =
  | "canonical_offer_terms"
  | "one_claim_per_user"
  | "participating_location_only"
  | "while_claims_remain"
  | "scheduled_window"
  | "claim_cutoff";

export type OfferDefinitionV1 = {
  schemaVersion: 1;
  status: "draft";
  source: "deal_eligibility_v1";
  merchantId: string;
  merchantName: string;
  locationId: string;
  locationName: string;
  timeZone: string | null;
  offerType: OfferDefinitionV1OfferType;
  qualifyingItems: OfferDefinitionV1Item[];
  reward: OfferDefinitionV1Reward;
  perUserClaimLimit: 1;
  totalClaimLimit: number | null;
  schedule: OfferDefinitionV1Schedule;
  redemption: OfferDefinitionV1Redemption;
  fulfillmentModes: ["in_store"];
  stackable: false;
  sourceAssetIds: string[];
  canonicalOfferLine: string;
  canonicalOfferSentence: string;
  canonicalTermsLine: string;
  disclosureIds: OfferDefinitionV1DisclosureId[];
  disclosureLine: string;
};

export type OfferDefinitionV1ValidationResult = {
  valid: boolean;
  reasonCodes: string[];
};

export type BuildOfferDefinitionV1Params = {
  businessId: string;
  businessName: string;
  locationId?: string | null;
  locationName?: string | null;
  dealEligibility: DealEligibilityInput;
  eligibilityResult?: DealEligibilityResult;
  activeWindowHumanReadable?: string | null;
  quantityLimit?: number | null;
  redemptionLimit?: string | null;
  schedule?: Partial<OfferDefinitionV1Schedule> | null;
  sourceAssetIds?: string[] | null;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanOptional(value: unknown): string | null {
  const clean = cleanText(value);
  return clean.length > 0 ? clean : null;
}

function positiveInteger(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function sentence(value: string): string {
  const clean = cleanText(value);
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function compactSentences(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => sentence(part ?? ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function nonEmptyArray(values: string[] | null | undefined): string[] {
  return (values ?? []).map(cleanText).filter(Boolean);
}

function normalizeSchedule(
  schedule: Partial<OfferDefinitionV1Schedule> | null | undefined,
  fallbackSummary?: string | null,
): OfferDefinitionV1Schedule {
  const summary = cleanOptional(schedule?.summary) ?? cleanOptional(fallbackSummary);
  const startsAt = cleanOptional(schedule?.startsAt);
  const endsAt = cleanOptional(schedule?.endsAt);
  const mode =
    schedule?.mode === "one_time" || schedule?.mode === "recurring" || schedule?.mode === "summary_only"
      ? schedule.mode
      : startsAt || endsAt
        ? "one_time"
        : "summary_only";
  return {
    mode,
    summary,
    startsAt,
    endsAt,
    timeZone: cleanOptional(schedule?.timeZone),
    daysOfWeek: Array.isArray(schedule?.daysOfWeek)
      ? schedule.daysOfWeek.filter((day) => Number.isInteger(day))
      : null,
    windowStartMinutes: nonNegativeInteger(schedule?.windowStartMinutes),
    windowEndMinutes: nonNegativeInteger(schedule?.windowEndMinutes),
  };
}

function disclosureIdsFor(params: {
  hasSchedule: boolean;
  hasQuantity: boolean;
  hasClaimCutoff: boolean;
}): OfferDefinitionV1DisclosureId[] {
  return [
    "canonical_offer_terms",
    "participating_location_only",
    "one_claim_per_user",
    ...(params.hasQuantity ? (["while_claims_remain"] as const) : []),
    ...(params.hasSchedule ? (["scheduled_window"] as const) : []),
    ...(params.hasClaimCutoff ? (["claim_cutoff"] as const) : []),
  ];
}

export function canonicalOfferSentence(definition: Pick<OfferDefinitionV1, "canonicalOfferLine">): string {
  return sentence(definition.canonicalOfferLine);
}

export function buildOfferDisclosureLine(
  definition: Pick<
    OfferDefinitionV1,
    "canonicalTermsLine" | "schedule" | "perUserClaimLimit" | "redemption"
  >,
): string {
  const claimLimit =
    definition.perUserClaimLimit === 1
      ? "Limit one claim per customer."
      : `Limit ${definition.perUserClaimLimit} claims per customer.`;
  return compactSentences([
    definition.canonicalTermsLine,
    definition.schedule.summary ? `Offer window: ${definition.schedule.summary}` : null,
    definition.redemption?.claimCutoffSummary ?? null,
    claimLimit,
  ]);
}

function baseItemsFromContract(
  contract: DealOfferContract,
  dealEligibility?: DealEligibilityInput,
): OfferDefinitionV1Item[] {
  if (contract.dealType === "PERCENT_OFF_SINGLE_ITEM") {
    const displayName = contract.singleItemDiscount?.itemName ?? "";
    return [
      {
        catalogItemId: cleanOptional(dealEligibility?.itemId),
        displayName,
        quantity: 1,
        verifiedAttributes: [],
      },
    ];
  }
  return [
    {
      catalogItemId: cleanOptional(dealEligibility?.requiredItemId),
      displayName: contract.requiredPurchase?.itemName ?? "",
      quantity: contract.requiredPurchase?.quantity ?? 1,
      verifiedAttributes: [],
    },
  ];
}

function rewardFromContract(
  contract: DealOfferContract,
  dealEligibility?: DealEligibilityInput,
): OfferDefinitionV1Reward {
  if (contract.dealType === "PERCENT_OFF_SINGLE_ITEM") {
    return {
      rule: "percent_off_single_item",
      discountPercent: contract.singleItemDiscount?.discountPercent ?? 0,
      quantity: 1,
      catalogItemIds: nonEmptyArray([cleanText(dealEligibility?.itemId)]),
      displayNames: nonEmptyArray([contract.singleItemDiscount?.itemName ?? ""]),
    };
  }
  return {
    rule: contract.dealType === "BUY_ONE_GET_ONE_FREE" ? "same_item_free" : "reward_item_free",
    discountPercent: 100,
    quantity: contract.freeReward?.quantity ?? 1,
    catalogItemIds: nonEmptyArray([cleanText(dealEligibility?.requiredItemId)]),
    displayNames: nonEmptyArray([contract.freeReward?.itemName ?? ""]),
  };
}

function offerTypeFromContract(contract: DealOfferContract): OfferDefinitionV1OfferType {
  if (contract.dealType === "BUY_ONE_GET_ONE_FREE") return "buy_one_get_one";
  if (contract.dealType === "BUY_ONE_GET_SOMETHING_FREE") return "buy_one_get_reward_item";
  return "percent_off_single_item";
}

export function buildOfferDefinitionV1FromContract(
  contract: DealOfferContract,
  options: {
    dealEligibility?: DealEligibilityInput;
    redemptionLimit?: string | null;
    schedule?: Partial<OfferDefinitionV1Schedule> | null;
    sourceAssetIds?: string[] | null;
  } = {},
): OfferDefinitionV1 {
  const schedule = normalizeSchedule(options.schedule, contract.activeWindow?.humanReadable);
  const totalClaimLimit = contract.quantityLimit?.totalAvailable ?? null;
  const redemption: OfferDefinitionV1Redemption = {
    exactLocationOnly: true,
    redeemAtBusinessName: contract.redemption.redeemAtBusinessName,
    redeemAtLocationName: contract.redemption.redeemAtLocationName,
    claimCutoffSummary: cleanOptional(options.redemptionLimit),
  };
  const shell = {
    schemaVersion: 1 as const,
    status: "draft" as const,
    source: "deal_eligibility_v1" as const,
    merchantId: contract.businessId,
    merchantName: contract.businessName,
    locationId: contract.locationId,
    locationName: contract.locationName,
    timeZone: schedule.timeZone,
    offerType: offerTypeFromContract(contract),
    qualifyingItems: baseItemsFromContract(contract, options.dealEligibility),
    reward: rewardFromContract(contract, options.dealEligibility),
    perUserClaimLimit: 1 as const,
    totalClaimLimit,
    schedule,
    fulfillmentModes: ["in_store"] as ["in_store"],
    stackable: false as const,
    sourceAssetIds: nonEmptyArray(options.sourceAssetIds ?? []),
    canonicalOfferLine: contract.canonicalOfferLine,
    canonicalOfferSentence: canonicalOfferSentence(contract),
    canonicalTermsLine: contract.canonicalShortTerms,
    disclosureIds: disclosureIdsFor({
      hasSchedule: Boolean(schedule.summary || schedule.startsAt || schedule.endsAt),
      hasQuantity: totalClaimLimit != null,
      hasClaimCutoff: Boolean(redemption.claimCutoffSummary),
    }),
    disclosureLine: "",
    redemption,
  };
  const disclosureLine = buildOfferDisclosureLine(shell);
  return { ...shell, disclosureLine };
}

export function buildOfferDefinitionV1(
  params: BuildOfferDefinitionV1Params,
): OfferDefinitionV1 | null {
  const contract = buildDealOfferContract({
    businessId: params.businessId,
    businessName: params.businessName,
    locationId: params.locationId,
    locationName: params.locationName,
    dealEligibility: params.dealEligibility,
    eligibilityResult: params.eligibilityResult,
    activeWindowHumanReadable: params.activeWindowHumanReadable,
    quantityLimit: params.quantityLimit,
  });
  if (!contract) return null;
  const definition = buildOfferDefinitionV1FromContract(contract, {
    dealEligibility: params.dealEligibility,
    redemptionLimit: params.redemptionLimit,
    schedule: params.schedule,
    sourceAssetIds: params.sourceAssetIds,
  });
  return validateOfferDefinitionV1(definition).valid ? definition : null;
}

export function validateOfferDefinitionV1(value: unknown): OfferDefinitionV1ValidationResult {
  const reasonCodes: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, reasonCodes: ["NOT_OBJECT"] };
  }
  const definition = value as Partial<OfferDefinitionV1>;
  if (definition.schemaVersion !== 1) reasonCodes.push("INVALID_SCHEMA_VERSION");
  if (definition.status !== "draft") reasonCodes.push("INVALID_STATUS");
  if (!cleanText(definition.merchantId)) reasonCodes.push("MISSING_MERCHANT_ID");
  if (!cleanText(definition.locationId)) reasonCodes.push("MISSING_LOCATION_ID");
  if (!cleanText(definition.locationName)) reasonCodes.push("MISSING_LOCATION_NAME");
  if (!cleanText(definition.canonicalOfferLine)) reasonCodes.push("MISSING_CANONICAL_OFFER");
  if (!cleanText(definition.canonicalOfferSentence)) reasonCodes.push("MISSING_CANONICAL_SENTENCE");
  if (!cleanText(definition.canonicalTermsLine)) reasonCodes.push("MISSING_TERMS");
  if (!cleanText(definition.disclosureLine)) reasonCodes.push("MISSING_DISCLOSURE");
  if (!Array.isArray(definition.qualifyingItems) || definition.qualifyingItems.length < 1) {
    reasonCodes.push("MISSING_QUALIFYING_ITEM");
  } else if (definition.qualifyingItems.some((item) => !cleanText(item.displayName) || !positiveInteger(item.quantity))) {
    reasonCodes.push("INVALID_QUALIFYING_ITEM");
  }
  if (!definition.reward || typeof definition.reward !== "object") {
    reasonCodes.push("MISSING_REWARD");
  } else if (
    !["same_item_free", "reward_item_free", "percent_off_single_item"].includes(definition.reward.rule) ||
    !Number.isFinite(definition.reward.discountPercent) ||
    definition.reward.discountPercent <= 0 ||
    !Array.isArray(definition.reward.displayNames) ||
    definition.reward.displayNames.length < 1
  ) {
    reasonCodes.push("INVALID_REWARD");
  }
  if (definition.totalClaimLimit != null && !positiveInteger(definition.totalClaimLimit)) {
    reasonCodes.push("INVALID_TOTAL_CLAIM_LIMIT");
  }
  if (!definition.schedule || typeof definition.schedule !== "object") {
    reasonCodes.push("MISSING_SCHEDULE");
  }
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}
