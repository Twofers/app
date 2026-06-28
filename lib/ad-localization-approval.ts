import type { AdLocalizationBundle } from "./ad-localization-schema";
import {
  buildOfferVersionLocalizationSnapshot,
  type OfferVersionPublishLocalizationSnapshot,
} from "./ad-localization-storage";
import type { AdPresentationLocaleOverride } from "./ad-presentation-spec";
import { stablePresentationJson } from "./ad-presentation-hash";
import type { OfferDefinitionV1 } from "./offer-definition";
import {
  enabledSupportedLocales,
  type SupportedLocale,
} from "./supported-locales";

export const AD_LOCALIZATION_APPROVAL_SCHEMA_VERSION = 1;
export const AD_LOCALIZATION_APPROVAL_POLICY_VERSION = "twofer-ad-localization-approval-v1";
export const AD_LOCALIZATION_REVIEW_POLICY_VERSION = "twofer-language-review-policy-v1";

export type AdLocalizationApprovalReasonCode =
  | "MISSING_LOCALIZATION_BUNDLE"
  | "MISSING_LOCALIZATION_SNAPSHOT"
  | "MISSING_PRESENTATION_HASH"
  | "INVALID_PRESENTATION_HASH"
  | "MISSING_SELECTED_IMAGE_ASSET"
  | "MISSING_SOURCE_CREATIVE_HASH"
  | "MISSING_LOCALIZATION_BUNDLE_HASH"
  | "MISSING_ENABLED_LOCALE"
  | "MISSING_AD_LOCALIZATION_ROW"
  | "INVALID_LOCALIZATION_ROW_HASH"
  | "PERSUASIVE_LOCALE_QA_NOT_PASSING"
  | "SOURCE_LOCALE_QA_INVALID"
  | "UNSUPPORTED_TRANSLATION_STATUS"
  | "LOCALIZATION_SNAPSHOT_SOURCE_LOCALE_MISMATCH"
  | "LOCALIZATION_SNAPSHOT_ENABLED_LOCALES_MISMATCH"
  | "LOCALIZATION_SNAPSHOT_SOURCE_HASH_MISMATCH"
  | "LOCALIZATION_SNAPSHOT_BUNDLE_HASH_MISMATCH"
  | "PROTECTED_TERM_CHANGED"
  | "LOCALE_PRESENTATION_REVIEW_REQUIRED"
  | "SCREENSHOT_QA_REQUIRED";

export type AdLocalizationApprovalSnapshot = {
  schemaVersion: typeof AD_LOCALIZATION_APPROVAL_SCHEMA_VERSION;
  policyVersion: typeof AD_LOCALIZATION_APPROVAL_POLICY_VERSION;
  reviewPolicyVersion: typeof AD_LOCALIZATION_REVIEW_POLICY_VERSION;
  approvalHash: string;
  offerDefinitionHash: string;
  sourceLocale: SupportedLocale;
  enabledLocales: SupportedLocale[];
  sourceCreativeHash: string;
  localizationBundleHash: string;
  deterministicFallbackLocales: SupportedLocale[];
  presentationHash: string;
  selectedImageAssetId: string;
  localeRendererVersion: string;
  localizedTermSnapshotHash: string;
  localePresentationOverridesHash: string | null;
  localizationRowHashes: Partial<Record<SupportedLocale, string>>;
};

export type BuildVerifiedAdLocalizationApprovalInput = {
  bundle?: AdLocalizationBundle | null;
  offerDefinition: OfferDefinitionV1;
  presentationHash?: string | null;
  selectedImageAssetId?: string | null;
  enabledLocales?: readonly SupportedLocale[] | null;
  providerStatus?: Parameters<typeof buildOfferVersionLocalizationSnapshot>[0]["providerStatus"];
  localePresentationOverrides?: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>> | null;
  localizationSnapshot?: OfferVersionPublishLocalizationSnapshot | null;
  screenshotQaRequired?: boolean;
};

export type VerifiedAdLocalizationApprovalResult =
  | {
      approved: true;
      approval: AdLocalizationApprovalSnapshot;
      localizationSnapshot: OfferVersionPublishLocalizationSnapshot;
      reasonCodes: [];
    }
  | {
      approved: false;
      approval: null;
      localizationSnapshot: OfferVersionPublishLocalizationSnapshot | null;
      reasonCodes: AdLocalizationApprovalReasonCode[];
    };

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function stableHash(prefix: string, value: unknown): string {
  const json = stablePresentationJson(value);
  let h1 = 0x811c9dc5 ^ json.length;
  let h2 = 0x01000193 ^ json.length;
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 16777619);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return `${prefix}_${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function offerDefinitionHash(offerDefinition: OfferDefinitionV1): string {
  return stableHash("offerdef", {
    schemaVersion: offerDefinition.schemaVersion,
    merchantId: offerDefinition.merchantId,
    locationId: offerDefinition.locationId,
    offerType: offerDefinition.offerType,
    qualifyingItems: offerDefinition.qualifyingItems,
    reward: offerDefinition.reward,
    perUserClaimLimit: offerDefinition.perUserClaimLimit,
    totalClaimLimit: offerDefinition.totalClaimLimit,
    schedule: offerDefinition.schedule,
    redemption: offerDefinition.redemption,
    fulfillmentModes: offerDefinition.fulfillmentModes,
    stackable: offerDefinition.stackable,
    canonicalOfferLine: offerDefinition.canonicalOfferLine,
    canonicalOfferSentence: offerDefinition.canonicalOfferSentence,
    canonicalTermsLine: offerDefinition.canonicalTermsLine,
    disclosureIds: offerDefinition.disclosureIds,
    disclosureLine: offerDefinition.disclosureLine,
  });
}

function localePresentationOverridesHash(
  overrides: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>> | undefined,
): string | null {
  return overrides && Object.keys(overrides).length > 0
    ? stableHash("adlocpres", overrides)
    : null;
}

function blockedPresentationReasons(
  overrides: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>> | undefined,
): AdLocalizationApprovalReasonCode[] {
  const codes: AdLocalizationApprovalReasonCode[] = [];
  for (const override of Object.values(overrides ?? {})) {
    if (override?.resolutionReasonCodes?.includes("LOCALE_TEXT_FIT_REVIEW_REQUIRED")) {
      codes.push("LOCALE_PRESENTATION_REVIEW_REQUIRED");
    }
  }
  return codes;
}

function localeListsMatch(left: readonly SupportedLocale[], right: readonly SupportedLocale[]): boolean {
  return left.length === right.length && left.every((locale, index) => locale === right[index]);
}

function validateLocaleRows(params: {
  snapshot: OfferVersionPublishLocalizationSnapshot;
  enabledLocales: readonly SupportedLocale[];
}): {
  reasonCodes: AdLocalizationApprovalReasonCode[];
  localizationRowHashes: Partial<Record<SupportedLocale, string>>;
} {
  const reasonCodes: AdLocalizationApprovalReasonCode[] = [];
  const localizationRowHashes: Partial<Record<SupportedLocale, string>> = {};
  for (const locale of params.enabledLocales) {
    const creative = params.snapshot.localizations[locale];
    const qa = params.snapshot.translationQaSummary[locale];
    if (!creative) {
      reasonCodes.push("MISSING_AD_LOCALIZATION_ROW");
      continue;
    }
    if (!/^adlocrow_[0-9a-f]{8}$/i.test(clean(creative.localizationHash))) {
      reasonCodes.push("INVALID_LOCALIZATION_ROW_HASH");
    } else {
      localizationRowHashes[locale] = creative.localizationHash;
    }
    if (qa?.qaReasonCodes?.includes("PROTECTED_TERM_CHANGED")) {
      reasonCodes.push("PROTECTED_TERM_CHANGED");
    }
    if (qa?.translationStatus === "source_creative") {
      if (qa.qaDecision !== "not_required") reasonCodes.push("SOURCE_LOCALE_QA_INVALID");
      continue;
    }
    if (qa?.translationStatus === "persuasive_transcreation") {
      if (qa.qaDecision !== "pass") reasonCodes.push("PERSUASIVE_LOCALE_QA_NOT_PASSING");
      continue;
    }
    if (qa?.translationStatus === "deterministic_fallback") continue;
    reasonCodes.push("UNSUPPORTED_TRANSLATION_STATUS");
  }
  return { reasonCodes, localizationRowHashes };
}

export function buildVerifiedAdLocalizationApproval(
  input: BuildVerifiedAdLocalizationApprovalInput,
): VerifiedAdLocalizationApprovalResult {
  const reasonCodes: AdLocalizationApprovalReasonCode[] = [];
  if (!input.bundle) reasonCodes.push("MISSING_LOCALIZATION_BUNDLE");
  const enabledLocales = enabledSupportedLocales(input.enabledLocales);
  const presentationHash = clean(input.presentationHash);
  if (!presentationHash) {
    reasonCodes.push("MISSING_PRESENTATION_HASH");
  } else if (!/^adp_[0-9a-f]{16}$/i.test(presentationHash)) {
    reasonCodes.push("INVALID_PRESENTATION_HASH");
  }
  const selectedImageAssetId = clean(input.selectedImageAssetId);
  if (!selectedImageAssetId) reasonCodes.push("MISSING_SELECTED_IMAGE_ASSET");
  if (input.screenshotQaRequired) reasonCodes.push("SCREENSHOT_QA_REQUIRED");

  const localizationSnapshot = input.localizationSnapshot ?? buildOfferVersionLocalizationSnapshot({
    bundle: input.bundle,
    offerDefinition: input.offerDefinition,
    enabledLocales,
    providerStatus: input.providerStatus,
    localePresentationOverrides: input.localePresentationOverrides,
  });
  if (!localizationSnapshot) reasonCodes.push("MISSING_LOCALIZATION_SNAPSHOT");
  if (!clean(input.bundle?.sourceCreativeHash)) reasonCodes.push("MISSING_SOURCE_CREATIVE_HASH");
  if (!clean(input.bundle?.localizationBundleHash)) reasonCodes.push("MISSING_LOCALIZATION_BUNDLE_HASH");
  if (localizationSnapshot && input.bundle) {
    if (localizationSnapshot.sourceLocale !== input.bundle.sourceLocale) {
      reasonCodes.push("LOCALIZATION_SNAPSHOT_SOURCE_LOCALE_MISMATCH");
    }
    if (!localeListsMatch(enabledSupportedLocales(localizationSnapshot.enabledLocales), enabledLocales)) {
      reasonCodes.push("LOCALIZATION_SNAPSHOT_ENABLED_LOCALES_MISMATCH");
    }
    if (clean(localizationSnapshot.sourceCreativeHash) !== clean(input.bundle.sourceCreativeHash)) {
      reasonCodes.push("LOCALIZATION_SNAPSHOT_SOURCE_HASH_MISMATCH");
    }
    if (clean(localizationSnapshot.localizationBundleHash) !== clean(input.bundle.localizationBundleHash)) {
      reasonCodes.push("LOCALIZATION_SNAPSHOT_BUNDLE_HASH_MISMATCH");
    }
  }

  for (const locale of enabledLocales) {
    if (!input.bundle?.localizations[locale]) reasonCodes.push("MISSING_ENABLED_LOCALE");
  }
  reasonCodes.push(...blockedPresentationReasons(localizationSnapshot?.localePresentationOverrides));

  const rowValidation = localizationSnapshot
    ? validateLocaleRows({ snapshot: localizationSnapshot, enabledLocales })
    : { reasonCodes: [] as AdLocalizationApprovalReasonCode[], localizationRowHashes: {} };
  reasonCodes.push(...rowValidation.reasonCodes);

  const uniqueReasonCodes = unique(reasonCodes);
  if (uniqueReasonCodes.length > 0 || !input.bundle || !localizationSnapshot) {
    return {
      approved: false,
      approval: null,
      localizationSnapshot,
      reasonCodes: uniqueReasonCodes,
    };
  }

  const localizedTermSnapshotHash = stableHash("adterms", localizationSnapshot.localizedTermSnapshot);
  const localeOverridesHash = localePresentationOverridesHash(localizationSnapshot.localePresentationOverrides);
  const withoutHash = {
    schemaVersion: AD_LOCALIZATION_APPROVAL_SCHEMA_VERSION,
    policyVersion: AD_LOCALIZATION_APPROVAL_POLICY_VERSION,
    reviewPolicyVersion: AD_LOCALIZATION_REVIEW_POLICY_VERSION,
    offerDefinitionHash: offerDefinitionHash(input.offerDefinition),
    sourceLocale: localizationSnapshot.sourceLocale,
    enabledLocales,
    sourceCreativeHash: localizationSnapshot.sourceCreativeHash,
    localizationBundleHash: localizationSnapshot.localizationBundleHash,
    deterministicFallbackLocales: localizationSnapshot.deterministicFallbackLocales,
    presentationHash,
    selectedImageAssetId,
    localeRendererVersion: localizationSnapshot.localeRendererVersion,
    localizedTermSnapshotHash,
    localePresentationOverridesHash: localeOverridesHash,
    localizationRowHashes: rowValidation.localizationRowHashes,
  } satisfies Omit<AdLocalizationApprovalSnapshot, "approvalHash">;
  return {
    approved: true,
    approval: {
      ...withoutHash,
      approvalHash: stableHash("adlocappr", withoutHash),
    },
    localizationSnapshot,
    reasonCodes: [],
  };
}
