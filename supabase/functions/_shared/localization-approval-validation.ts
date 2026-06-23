const SUPPORTED_LOCALES = ["en-US", "es-US", "ko-KR"];
const AD_LOCALIZATION_APPROVAL_SCHEMA_VERSION = 1;
const AD_LOCALIZATION_APPROVAL_POLICY_VERSION = "twofer-ad-localization-approval-v1";
const AD_LOCALIZATION_REVIEW_POLICY_VERSION = "twofer-language-review-policy-v1";

type RecordValue = Record<string, unknown>;

export type ExactLocalizationApprovalValidationInput = {
  localization: unknown;
  composedCard: unknown;
  offerDefinition: unknown;
  exactRequired: boolean;
};

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<RecordValue>((acc, key) => {
        const current = value[key];
        if (current !== undefined) acc[key] = stableValue(current);
        return acc;
      }, {});
  }
  return value;
}

function stableApprovalJson(value: unknown): string {
  const json = JSON.stringify(stableValue(value));
  return typeof json === "string" ? json : "undefined";
}

function stableApprovalHash(prefix: string, value: unknown): string {
  const json = stableApprovalJson(value);
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

function stableRowJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableRowJson).join(",")}]`;
  const record = value as RecordValue;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableRowJson(record[key])}`)
    .join(",")}}`;
}

function hashRowString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function localizationRowHash(row: RecordValue): string {
  const { localizationHash: _localizationHash, ...withoutHash } = row;
  return `adlocrow_${hashRowString(stableRowJson(withoutHash))}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => cleanText(item).length > 0);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function objectKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function offerDefinitionHash(offerDefinition: unknown): string {
  const definition = isRecord(offerDefinition) ? offerDefinition : {};
  return stableApprovalHash("offerdef", {
    schemaVersion: definition.schemaVersion,
    merchantId: definition.merchantId,
    locationId: definition.locationId,
    offerType: definition.offerType,
    qualifyingItems: definition.qualifyingItems,
    reward: definition.reward,
    perUserClaimLimit: definition.perUserClaimLimit,
    totalClaimLimit: definition.totalClaimLimit,
    schedule: definition.schedule,
    redemption: definition.redemption,
    fulfillmentModes: definition.fulfillmentModes,
    stackable: definition.stackable,
    canonicalOfferLine: definition.canonicalOfferLine,
    canonicalOfferSentence: definition.canonicalOfferSentence,
    canonicalTermsLine: definition.canonicalTermsLine,
    disclosureIds: definition.disclosureIds,
    disclosureLine: definition.disclosureLine,
  });
}

function localePresentationOverridesHash(overrides: unknown): string | null {
  return isRecord(overrides) && objectKeys(overrides).length > 0
    ? stableApprovalHash("adlocpres", overrides)
    : null;
}

function approvalWithoutHash(approval: RecordValue): RecordValue {
  return {
    schemaVersion: approval.schemaVersion,
    policyVersion: approval.policyVersion,
    reviewPolicyVersion: approval.reviewPolicyVersion,
    offerDefinitionHash: approval.offerDefinitionHash,
    sourceLocale: approval.sourceLocale,
    enabledLocales: approval.enabledLocales,
    sourceCreativeHash: approval.sourceCreativeHash,
    localizationBundleHash: approval.localizationBundleHash,
    deterministicFallbackLocales: approval.deterministicFallbackLocales,
    presentationHash: approval.presentationHash,
    selectedImageAssetId: approval.selectedImageAssetId,
    localeRendererVersion: approval.localeRendererVersion,
    localizedTermSnapshotHash: approval.localizedTermSnapshotHash,
    localePresentationOverridesHash: approval.localePresentationOverridesHash,
    localizationRowHashes: approval.localizationRowHashes,
  };
}

function includesReason(value: unknown, reason: string): boolean {
  return Array.isArray(value) && value.some((item) => cleanText(item) === reason);
}

function validateTranslationQaSummary(params: {
  enabledLocales: readonly string[];
  summary: unknown;
}): string[] {
  const reasonCodes: string[] = [];
  if (!isRecord(params.summary)) return ["INVALID_TRANSLATION_QA_SUMMARY"];
  for (const locale of params.enabledLocales) {
    const qa = params.summary[locale];
    if (!isRecord(qa)) {
      reasonCodes.push("MISSING_TRANSLATION_QA_SUMMARY");
      continue;
    }
    if (includesReason(qa.qaReasonCodes, "PROTECTED_TERM_CHANGED")) {
      reasonCodes.push("PROTECTED_TERM_CHANGED");
    }
    const status = cleanText(qa.translationStatus);
    const decision = cleanText(qa.qaDecision);
    if (status === "source_creative") {
      if (decision !== "not_required") reasonCodes.push("SOURCE_LOCALE_QA_INVALID");
      continue;
    }
    if (status === "persuasive_transcreation") {
      if (decision !== "pass") reasonCodes.push("PERSUASIVE_LOCALE_QA_NOT_PASSING");
      continue;
    }
    if (status === "deterministic_fallback") continue;
    reasonCodes.push("UNSUPPORTED_TRANSLATION_STATUS");
  }
  return reasonCodes;
}

function validateLocalePresentationOverrides(overrides: unknown): string[] {
  const reasonCodes: string[] = [];
  if (!isRecord(overrides)) return reasonCodes;
  for (const override of Object.values(overrides)) {
    if (isRecord(override) && includesReason(override.resolutionReasonCodes, "LOCALE_TEXT_FIT_REVIEW_REQUIRED")) {
      reasonCodes.push("LOCALE_PRESENTATION_REVIEW_REQUIRED");
    }
  }
  return reasonCodes;
}

function validateRowHashes(params: {
  enabledLocales: readonly string[];
  localizations: unknown;
  approvalRowHashes: unknown;
}): string[] {
  const reasonCodes: string[] = [];
  if (!isRecord(params.localizations) || !isRecord(params.approvalRowHashes)) return reasonCodes;
  for (const locale of params.enabledLocales) {
    const row = params.localizations[locale];
    if (!isRecord(row)) {
      reasonCodes.push("MISSING_AD_LOCALIZATION");
      continue;
    }
    const rowHash = cleanText(row.localizationHash);
    const approvedRowHash = cleanText(params.approvalRowHashes[locale]);
    if (!/^adlocrow_[0-9a-f]{8}$/i.test(rowHash)) {
      reasonCodes.push("INVALID_AD_LOCALIZATION_HASH");
      continue;
    }
    if (rowHash !== localizationRowHash(row)) {
      reasonCodes.push("STALE_LOCALIZATION_HASH");
    }
    if (approvedRowHash !== rowHash) {
      reasonCodes.push("LOCALIZATION_APPROVAL_ROW_HASH_MISMATCH");
    }
    if (includesReason(row.qaReasonCodes, "PROTECTED_TERM_CHANGED")) {
      reasonCodes.push("PROTECTED_TERM_CHANGED");
    }
  }
  return reasonCodes;
}

export function validateExactLocalizationApprovalPayload(
  input: ExactLocalizationApprovalValidationInput,
): string[] {
  if (!input.exactRequired) return [];
  const reasonCodes: string[] = [];
  if (!isRecord(input.localization)) return ["MISSING_LOCALIZATION_APPROVAL"];
  const localization = input.localization;
  const approval = localization.approval;
  if (!isRecord(approval)) return ["MISSING_LOCALIZATION_APPROVAL"];

  const enabledLocales = isStringArray(localization.enabledLocales) ? localization.enabledLocales : [];
  const approvalEnabledLocales = isStringArray(approval.enabledLocales) ? approval.enabledLocales : [];
  const deterministicFallbackLocales = isStringArray(localization.deterministicFallbackLocales)
    ? localization.deterministicFallbackLocales
    : [];
  const approvalFallbackLocales = isStringArray(approval.deterministicFallbackLocales)
    ? approval.deterministicFallbackLocales
    : [];

  if (approval.schemaVersion !== AD_LOCALIZATION_APPROVAL_SCHEMA_VERSION) {
    reasonCodes.push("INVALID_LOCALIZATION_APPROVAL_SCHEMA_VERSION");
  }
  if (approval.policyVersion !== AD_LOCALIZATION_APPROVAL_POLICY_VERSION) {
    reasonCodes.push("INVALID_LOCALIZATION_APPROVAL_POLICY_VERSION");
  }
  if (approval.reviewPolicyVersion !== AD_LOCALIZATION_REVIEW_POLICY_VERSION) {
    reasonCodes.push("INVALID_LOCALIZATION_REVIEW_POLICY_VERSION");
  }
  if (!/^adlocappr_[0-9a-f]{16}$/i.test(cleanText(approval.approvalHash))) {
    reasonCodes.push("INVALID_LOCALIZATION_APPROVAL_HASH");
  } else if (cleanText(approval.approvalHash) !== stableApprovalHash("adlocappr", approvalWithoutHash(approval))) {
    reasonCodes.push("LOCALIZATION_APPROVAL_HASH_MISMATCH");
  }
  if (cleanText(approval.offerDefinitionHash) !== offerDefinitionHash(input.offerDefinition)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_OFFER_HASH_MISMATCH");
  }
  if (cleanText(approval.sourceLocale) !== cleanText(localization.sourceLocale)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_SOURCE_LOCALE_MISMATCH");
  }
  if (!arraysEqual(approvalEnabledLocales, enabledLocales)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_ENABLED_LOCALES_MISMATCH");
  }
  if (!approvalEnabledLocales.every((locale) => SUPPORTED_LOCALES.includes(locale))) {
    reasonCodes.push("INVALID_LOCALIZATION_APPROVAL_ENABLED_LOCALES");
  }
  if (cleanText(approval.sourceCreativeHash) !== cleanText(localization.sourceCreativeHash)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_SOURCE_HASH_MISMATCH");
  }
  if (cleanText(approval.localizationBundleHash) !== cleanText(localization.localizationBundleHash)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_BUNDLE_HASH_MISMATCH");
  }
  if (!arraysEqual(approvalFallbackLocales, deterministicFallbackLocales)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_FALLBACK_LOCALES_MISMATCH");
  }
  if (cleanText(approval.localeRendererVersion) !== cleanText(localization.localeRendererVersion)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_RENDERER_VERSION_MISMATCH");
  }
  if (cleanText(approval.localizedTermSnapshotHash) !== stableApprovalHash("adterms", localization.localizedTermSnapshot)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_TERM_HASH_MISMATCH");
  }
  if (approval.localePresentationOverridesHash !== localePresentationOverridesHash(localization.localePresentationOverrides)) {
    reasonCodes.push("LOCALIZATION_APPROVAL_PRESENTATION_OVERRIDES_HASH_MISMATCH");
  }

  const composed = isRecord(input.composedCard) ? input.composedCard : null;
  const presentation = isRecord(composed?.presentation) ? composed.presentation : null;
  if (!composed || !presentation) {
    reasonCodes.push("MISSING_LOCALIZATION_APPROVAL_PRESENTATION");
  } else {
    if (cleanText(approval.presentationHash) !== cleanText(composed.presentationHash)) {
      reasonCodes.push("LOCALIZATION_APPROVAL_PRESENTATION_HASH_MISMATCH");
    }
    if (cleanText(approval.selectedImageAssetId) !== cleanText(presentation.imageAssetId)) {
      reasonCodes.push("LOCALIZATION_APPROVAL_SELECTED_IMAGE_MISMATCH");
    }
  }

  reasonCodes.push(
    ...validateRowHashes({
      enabledLocales,
      localizations: localization.localizations,
      approvalRowHashes: approval.localizationRowHashes,
    }),
  );
  reasonCodes.push(...validateTranslationQaSummary({ enabledLocales, summary: localization.translationQaSummary }));
  reasonCodes.push(...validateLocalePresentationOverrides(localization.localePresentationOverrides));

  return [...new Set(reasonCodes)];
}
