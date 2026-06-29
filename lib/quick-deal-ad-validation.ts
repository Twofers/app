import { composeListingDescription } from "./ad-variants";
import {
  assessDealQuality,
  type DealQualityBlockReason,
  type DealQualityResult,
} from "./deal-quality";
import {
  buildDealOfferContract,
  validateAiCopyAgainstOffer,
  type DealOfferContract,
} from "./deal-offer-contract";
import { type DealEligibilityInput, type DealEligibilityResult } from "./deal-eligibility";
import {
  validateStrongDealOnly,
} from "./strong-deal-guard";

export type QuickDealAdField = "headline" | "offer" | "imagePrompt" | "image";

export type QuickDealAdRuleId =
  | "RULE_HEADLINE_REQUIRED"
  | "RULE_HEADLINE_TOO_SHORT"
  | "RULE_HEADLINE_TOO_LONG"
  | "RULE_OFFER_REQUIRED"
  | "RULE_OFFER_TOO_LONG"
  | "RULE_VALUE_PRESENT"
  | "RULE_VALUE_AT_A_GLANCE"
  | "RULE_NO_METADATA_IN_COPY"
  | "RULE_OFFER_MECHANICS"
  | "RULE_STRONG_DEAL_REQUIRED"
  | "RULE_INELIGIBLE_DEAL";

export type QuickDealAdValidationError = {
  field: QuickDealAdField;
  ruleId: QuickDealAdRuleId;
  message: string;
  severity: "warning" | "blocking";
  sourceReason?: string;
};

export type QuickDealAdValidationResult = {
  ok: boolean;
  errors: QuickDealAdValidationError[];
  blockingErrors: QuickDealAdValidationError[];
  warnings: QuickDealAdValidationError[];
  quality: DealQualityResult | null;
  strongGuard: ReturnType<typeof validateStrongDealOnly> | null;
  offerContract: DealOfferContract | null;
};

export type QuickDealAdCandidate = {
  headline: string;
  offer: string;
  cta?: string | null;
};

export type QuickDealAdValidationContext = {
  businessId: string;
  businessName: string;
  locationName?: string | null;
  dealEligibility: DealEligibilityInput;
  eligibilityResult: DealEligibilityResult;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function pushUnique(
  errors: QuickDealAdValidationError[],
  error: QuickDealAdValidationError,
): void {
  if (errors.some((existing) => existing.field === error.field && existing.ruleId === error.ruleId)) return;
  errors.push(error);
}

function qualityRuleFor(reason: DealQualityBlockReason | null): QuickDealAdRuleId {
  if (reason === "TITLE_SHORT") return "RULE_HEADLINE_TOO_SHORT";
  if (reason === "CLARIFY_VALUE") return "RULE_VALUE_PRESENT";
  return "RULE_VALUE_AT_A_GLANCE";
}

function fieldForQualityReason(reason: DealQualityBlockReason | null): QuickDealAdField {
  return reason === "TITLE_SHORT" ? "headline" : "offer";
}

function addOfferContractErrors(
  errors: QuickDealAdValidationError[],
  reasonCodes: readonly string[],
): void {
  for (const reasonCode of reasonCodes) {
    if (reasonCode === "COPY_CONTAINS_METADATA") {
      pushUnique(errors, {
        field: "offer",
        ruleId: "RULE_NO_METADATA_IN_COPY",
        message: "Remove address, dates, times, and inventory from the offer copy.",
        severity: "blocking",
        sourceReason: reasonCode,
      });
      continue;
    }

    if (reasonCode === "HEADLINE_TOO_LONG") {
      pushUnique(errors, {
        field: "headline",
        ruleId: "RULE_HEADLINE_TOO_LONG",
        message: "Keep the headline shorter.",
        severity: "blocking",
        sourceReason: reasonCode,
      });
      continue;
    }

    if (reasonCode === "SHORT_DESCRIPTION_TOO_LONG") {
      pushUnique(errors, {
        field: "offer",
        ruleId: "RULE_OFFER_TOO_LONG",
        message: "Keep the offer copy shorter.",
        severity: "blocking",
        sourceReason: reasonCode,
      });
      continue;
    }

    if (reasonCode.startsWith("MISSING_") || reasonCode === "VAGUE_GET_ONE_FREE") {
      pushUnique(errors, {
        field: "offer",
        ruleId: "RULE_VALUE_PRESENT",
        message: "Spell out the value, including the item customers buy and what they get.",
        severity: "blocking",
        sourceReason: reasonCode,
      });
      continue;
    }

    pushUnique(errors, {
      field: "offer",
      ruleId: "RULE_OFFER_MECHANICS",
      message: "Keep the offer mechanics exact: what customers buy, what they get, and the discount.",
      severity: "blocking",
      sourceReason: reasonCode,
    });
  }
}

export function validateQuickDealAd(
  ad: QuickDealAdCandidate,
  context: QuickDealAdValidationContext,
): QuickDealAdValidationResult {
  const headline = clean(ad.headline);
  const offer = clean(ad.offer);
  const cta = clean(ad.cta);
  const errors: QuickDealAdValidationError[] = [];

  if (!headline) {
    pushUnique(errors, {
      field: "headline",
      ruleId: "RULE_HEADLINE_REQUIRED",
      message: "Add a headline first.",
      severity: "blocking",
    });
  } else if (headline.length < 8) {
    pushUnique(errors, {
      field: "headline",
      ruleId: "RULE_HEADLINE_TOO_SHORT",
      message: "Use a specific headline with the item and value.",
      severity: "blocking",
    });
  }

  if (!offer) {
    pushUnique(errors, {
      field: "offer",
      ruleId: "RULE_OFFER_REQUIRED",
      message: "Spell out the offer before previewing.",
      severity: "blocking",
    });
  }

  if (!context.eligibilityResult.eligible) {
    pushUnique(errors, {
      field: "offer",
      ruleId: "RULE_INELIGIBLE_DEAL",
      message:
        context.eligibilityResult.message ??
        "Twofer deals must be free-item offers or at least 40% off one single item.",
      severity: "blocking",
      sourceReason: context.eligibilityResult.reasonCode,
    });
  }

  const offerContract =
    context.eligibilityResult.eligible
      ? buildDealOfferContract({
          businessId: context.businessId,
          businessName: context.businessName,
          locationId: context.businessId,
          locationName: context.locationName ?? context.businessName,
          dealEligibility: context.dealEligibility,
          eligibilityResult: context.eligibilityResult,
        })
      : null;

  let offerContractValid = false;
  if (headline && offer && offerContract) {
    const offerValidation = validateAiCopyAgainstOffer(
      {
        headline,
        short_description: offer,
        push_notification: headline,
        social_caption: `${headline}. ${offer}`,
      },
      offerContract,
    );
    if (!offerValidation.valid) {
      addOfferContractErrors(errors, offerValidation.reasonCodes);
    } else {
      offerContractValid = true;
    }
  }

  const guardDescription = composeListingDescription(offer, cta, "");
  const quality =
    headline && offer
      ? assessDealQuality({ title: headline, description: guardDescription, price: null })
      : null;
  if (quality?.blocked && !(offerContractValid && quality.blockReason === "CLARIFY_VALUE")) {
    pushUnique(errors, {
      field: fieldForQualityReason(quality.blockReason),
      ruleId: qualityRuleFor(quality.blockReason),
      message: quality.message,
      severity: "blocking",
      sourceReason: quality.blockReason ?? undefined,
    });
  }

  const strongGuard =
    headline && offer
      ? validateStrongDealOnly({ title: headline, description: guardDescription })
      : null;
  if (strongGuard && !strongGuard.ok) {
    pushUnique(errors, {
      field: "offer",
      ruleId: "RULE_STRONG_DEAL_REQUIRED",
      message: "Every Twofer deal must be at least 40% off or give something free.",
      severity: "blocking",
      sourceReason: strongGuard.reason,
    });
  }

  const blockingErrors = errors.filter((error) => error.severity === "blocking");
  const warnings = errors.filter((error) => error.severity === "warning");

  return {
    ok: blockingErrors.length === 0,
    errors,
    blockingErrors,
    warnings,
    quality,
    strongGuard,
    offerContract,
  };
}
