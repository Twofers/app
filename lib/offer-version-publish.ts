import type { GeneratedAd } from "./ad-variants";
import {
  buildDeterministicDealChannelCopy,
  validateAiCopyAgainstOffer,
  type AiDealCopyVariant,
  type DealOfferContract,
} from "./deal-offer-contract";
import {
  buildOfferVersionLocalizationSnapshot,
  type OfferVersionPublishLocalizationSnapshot,
} from "./ad-localization-storage";
import type { AdLocalizationApprovalSnapshot } from "./ad-localization-approval";
import {
  buildAdSpecV1,
  type AdSpecV1,
  type AdSpecSource,
} from "./ad-spec";
import { shouldRunCompositeScreenshotQa, type AdCompositeQaResult } from "./ad-composite-qa";
import type { AdPresentationSpec } from "./ad-presentation-spec";
import type { OfferDefinitionV1 } from "./offer-definition";
import { EDGE_FN_TIMEOUT_DEFAULT_MS } from "@/constants/timing";

export type OfferVersionPublishDealRow = Record<string, unknown> & {
  business_id: string;
};

export type OfferVersionPublishComposedCardSpec = {
  presentation: AdPresentationSpec;
  presentationHash: string;
  selectedTemplateId: AdPresentationSpec["templateId"];
  alternateTemplateIds: AdPresentationSpec["templateId"][];
  merchantStyleOverrideUsed: boolean;
  compositeQa: AdCompositeQaResult;
  screenshotQa: OfferVersionPublishScreenshotQaSnapshot;
};

export type OfferVersionPublishScreenshotQaSnapshot = {
  required: boolean;
  triggerCodes: string[];
  decision: "not_run" | "pass" | "block" | "unavailable";
};

export type OfferVersionPublishAdSpec = AdSpecV1 & {
  composedCard?: OfferVersionPublishComposedCardSpec | null;
  localization?: OfferVersionPublishLocalizationSnapshot | null;
};

export type PublishOfferVersionedDealBody = {
  business_id: string;
  offer_definition: OfferDefinitionV1;
  deal_rows: OfferVersionPublishDealRow[];
  idempotency_key: string;
  ad_spec?: OfferVersionPublishAdSpec | null;
};

export type PublishOfferVersionedDealResult = {
  ok: boolean;
  deals: Array<{
    deal_id: string;
    offer_definition_id: string;
    offer_version_id: string;
    idempotency_replayed?: boolean;
  }>;
};

export type AuthoritativeDealDisplayCopy = {
  title: string;
  description: string;
};

export type PublishMechanicsValidationCopy = Pick<
  AiDealCopyVariant,
  "headline" | "short_description" | "push_notification"
> & {
  terms_summary: string;
};

type ErrorWithCode = Error & { code?: string; reasonCodes?: string[] };

function cleanDisplayText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function buildAuthoritativeDealDisplayCopy(
  offerDefinition: OfferDefinitionV1 | null | undefined,
  fallback: AuthoritativeDealDisplayCopy,
  options?: {
    // A merchant-typed title that has ALREADY passed
    // checkMerchantDealTitleAgainstOffer. When present it wins over the
    // canonical offer line so merchant edits survive publish; the canonical
    // facts still ship in the description/locked offer line.
    factSafeMerchantTitle?: string | null;
  },
): AuthoritativeDealDisplayCopy {
  const fallbackTitle = cleanDisplayText(fallback.title);
  const fallbackDescription = cleanDisplayText(fallback.description);
  const merchantTitle = cleanDisplayText(options?.factSafeMerchantTitle);
  if (!offerDefinition) return { title: merchantTitle || fallbackTitle, description: fallbackDescription };

  const title =
    merchantTitle ||
    cleanDisplayText(offerDefinition.canonicalOfferLine) ||
    cleanDisplayText(offerDefinition.canonicalOfferSentence) ||
    fallbackTitle;
  const description =
    cleanDisplayText(offerDefinition.disclosureLine) ||
    cleanDisplayText(offerDefinition.canonicalTermsLine) ||
    fallbackDescription;

  return { title, description };
}

// Reason codes from validateAiCopyAgainstOffer that mean the text CONTRADICTS
// the locked offer facts (wrong percent, "free" on a percent-off deal, changed
// quantities/items, stale-able metadata) rather than merely omitting them or
// tripping AI-style checks. Merchant-typed titles may omit facts — the locked
// offer line carries them — but must never contradict them.
const MERCHANT_TITLE_CONTRADICTION_CODES = new Set([
  "GENERIC_BOGO_NOT_ALLOWED",
  "GENERIC_BUY_ONE_GET_ONE_NOT_ALLOWED",
  "BUYS_BOTH_ITEMS",
  "FREE_ITEM_ADDED_TO_PURCHASE",
  "REQUIRED_QUANTITY_CHANGED",
  "FREE_QUANTITY_CHANGED",
  "REQUIRES_TWO_PURCHASES",
  "SECOND_ITEM_DISCOUNTED_NOT_FREE",
  "CHANGES_FREE_ITEM",
  "FREE_OR_BOGO_LANGUAGE_NOT_ALLOWED",
  "SINGLE_ITEM_SCOPE_CHANGED",
  "DISCOUNT_PERCENT_CHANGED",
  "COPY_CONTAINS_METADATA",
]);

export type MerchantDealTitleCheck = {
  ok: boolean;
  blockingCodes: string[];
};

export function checkMerchantDealTitleAgainstOffer(
  input: {
    title?: string | null;
    supportingLine?: string | null;
  },
  contract: DealOfferContract | null | undefined,
): MerchantDealTitleCheck {
  const cleanTitle = cleanDisplayText(input.title);
  const cleanSupporting = cleanDisplayText(input.supportingLine);
  if ((!cleanTitle && !cleanSupporting) || !contract) return { ok: true, blockingCodes: [] };
  // Validate the merchant text alongside deterministic filler copy: the filler
  // supplies the offer facts so omission codes (MISSING_*) stay quiet, while
  // contradictions introduced by the merchant text still fire.
  const deterministic = buildDeterministicDealChannelCopy(contract);
  const result = validateAiCopyAgainstOffer(
    {
      headline: cleanTitle || deterministic.headline,
      short_description: cleanSupporting || deterministic.description,
      push_notification: deterministic.pushBody,
    },
    contract,
  );
  const blockingCodes = result.reasonCodes.filter((code) => {
    // Length only blocks when the merchant actually typed the title; the
    // deterministic filler headline may legitimately exceed the limit for
    // long product names.
    if (code === "HEADLINE_TOO_LONG") return Boolean(cleanTitle);
    return MERCHANT_TITLE_CONTRADICTION_CODES.has(code);
  });
  return { ok: blockingCodes.length === 0, blockingCodes };
}

export function buildPublishMechanicsValidationCopy(
  offerDefinition: OfferDefinitionV1,
): PublishMechanicsValidationCopy {
  const lockedOffer = cleanDisplayText(offerDefinition.canonicalOfferLine);
  const supportLine = "Redeem at the participating location during the offer window.";

  return {
    headline: lockedOffer,
    short_description: supportLine,
    push_notification: lockedOffer,
    terms_summary: lockedOffer,
  };
}

function throwInvokeError(message: string, code?: string, reasonCodes?: string[]): never {
  const err = new Error(message) as ErrorWithCode;
  if (code) err.code = code;
  if (reasonCodes?.length) err.reasonCodes = reasonCodes;
  throw err;
}

function parsePublishFunctionError(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message.trim()) return message;
  return "We couldn't publish this offer right now. Please try again.";
}

async function readInvokeErrorBody(error: unknown): Promise<{ message?: string; code?: string; reasonCodes?: string[] }> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const data = await ctx.clone().json();
      if (data && typeof data === "object") {
        const o = data as { error?: unknown; error_code?: unknown; reason_codes?: unknown };
        const reasonCodes = Array.isArray(o.reason_codes)
          ? o.reason_codes.filter((code): code is string => typeof code === "string" && code.trim().length > 0)
          : undefined;
        return {
          message: typeof o.error === "string" ? o.error : undefined,
          code: typeof o.error_code === "string" ? o.error_code : undefined,
          reasonCodes,
        };
      }
    } catch {
      /* fall through to parseFunctionError */
    }
  }
  return {};
}

export function createPublishIdempotencyKey(scope: "create_ai" | "create_quick"): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  const id =
    typeof randomUUID === "function"
      ? randomUUID.call(globalThis.crypto)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${scope}:${id}`;
}

export function buildComposedScreenshotQaSnapshot(
  compositeQa: AdCompositeQaResult,
  screenshotQaEnabled: boolean,
): OfferVersionPublishScreenshotQaSnapshot {
  return {
    required: screenshotQaEnabled && shouldRunCompositeScreenshotQa(compositeQa),
    triggerCodes: [...new Set(compositeQa.screenshotQaTriggerCodes)],
    decision: "not_run",
  };
}

export function buildOfferVersionPublishAdSpec(
  source: AdSpecSource,
  offerDefinition: OfferDefinitionV1,
  generatedAd: GeneratedAd | null | undefined,
  options?: {
    composedCard?: OfferVersionPublishComposedCardSpec | null;
    localization?: OfferVersionPublishLocalizationSnapshot | null;
    localizationApproval?: AdLocalizationApprovalSnapshot | null;
  },
): OfferVersionPublishAdSpec {
  const spec = buildAdSpecV1({
    source,
    offerDefinition,
    generatedAd,
    selectedLanguage: generatedAd?.localization_bundle?.sourceLocale,
  });
  const hasLocalizationOverride =
    options != null && Object.prototype.hasOwnProperty.call(options, "localization");
  const localization = hasLocalizationOverride
    ? options?.localization ?? null
    : buildOfferVersionLocalizationSnapshot({
        bundle: generatedAd?.localization_bundle ?? null,
        offerDefinition,
        providerStatus: generatedAd?.localization_status ?? null,
        localePresentationOverrides: options?.composedCard?.presentation.localeOverrides ?? null,
        approval: options?.localizationApproval ?? null,
      });
  if (!options?.composedCard && !localization) return spec;
  return {
    ...spec,
    ...(options?.composedCard ? { composedCard: options.composedCard } : {}),
    ...(localization ? { localization } : {}),
  };
}

export async function publishOfferVersionedDeal(
  body: PublishOfferVersionedDealBody,
): Promise<PublishOfferVersionedDealResult> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.functions.invoke("publish-offer-version", {
    body,
    timeout: EDGE_FN_TIMEOUT_DEFAULT_MS,
  });
  if (error) {
    const fromBody = await readInvokeErrorBody(error);
    throwInvokeError(fromBody.message ?? parsePublishFunctionError(error), fromBody.code, fromBody.reasonCodes);
  }
  if (!data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) {
    throw new Error("Unexpected response from publish-offer-version.");
  }
  const result = data as PublishOfferVersionedDealResult;
  return {
    ok: true,
    deals: Array.isArray(result.deals) ? result.deals : [],
  };
}
