import {
  generateStructuredText,
  resolveAiTextProviderConfig,
  type AiTextProviderDeps,
  type ProviderAttempt,
} from "./ai-text-provider.ts";
import {
  buildQaCheckedAdLocalizationBundle,
} from "../../../lib/ad-localization.ts";
import type {
  AdLocalizationBundle,
  AdTranslationQaResult,
  SourceAdCreative,
} from "../../../lib/ad-localization-schema.ts";
import {
  AD_TRANSLATION_FIELD_LIMITS,
  validateAdTranscreationDeterministically,
} from "../../../lib/ad-translation-qa.ts";
import type { OfferDefinitionV1 } from "../../../lib/offer-definition.ts";

export type SupportedAdLocale = "en-US" | "es-US" | "ko-KR";

export type AdLocalizationSourceCreative = {
  strategy?: string | null;
  headline: string;
  supportingCopy?: string | null;
  imageAltText: string;
};

export type AdLocalizationCreativeBrief = {
  targetCustomerMoment?: string | null;
  exactCustomerHook?: string | null;
  desiredFeeling?: string | null;
  naturalLanguageDirection?: string | null;
  visualStory?: string | null;
};

export type AdLocalizationOfferFacts = {
  merchantName: string;
  locationName: string;
  offerType: string;
  paidItems: Array<{
    displayName: string;
    quantity: number;
  }>;
  reward: {
    rule: string;
    displayNames: string[];
    quantity: number;
    discountPercent: number;
  };
  scheduleSummary?: string | null;
  totalClaimLimit?: number | null;
  redemptionLocationName?: string | null;
};

export type OfferDefinitionForLocalization = {
  merchantName: string;
  locationName: string;
  offerType: string;
  qualifyingItems: Array<{
    displayName: string;
    quantity: number;
  }>;
  reward: {
    rule: string;
    displayNames: string[];
    quantity: number;
    discountPercent: number;
  };
  schedule: {
    summary: string | null;
  };
  totalClaimLimit: number | null;
  redemption: {
    redeemAtLocationName: string;
  };
};

export type AdLocalizationProviderRequest = {
  adVersionId: string;
  sourceLocale: SupportedAdLocale;
  targetLocales: SupportedAdLocale[];
  sourceCreative: AdLocalizationSourceCreative;
  creativeBrief?: AdLocalizationCreativeBrief | null;
  offerFacts: AdLocalizationOfferFacts;
  protectedTerms: string[];
  localizedTerms?: unknown[] | null;
  merchantProfile?: unknown;
  generationRunId: string;
};

export type AdLocalizationProviderCreative = {
  locale: SupportedAdLocale;
  headline: string;
  supportingCopy: string;
  imageAltText: string;
};

export type AdLocalizationProviderResult = {
  targetCreatives: Partial<Record<SupportedAdLocale, AdLocalizationProviderCreative>>;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  skippedReason?: string;
  attempts: ProviderAttempt[];
  promptVersion: string;
};

export type VerifiedAdLocalizationBundleResult = {
  bundle: AdLocalizationBundle;
  transcreation: AdLocalizationProviderResult;
  repairs: Partial<Record<SupportedAdLocale, AdLocalizationProviderResult>>;
  deterministicQa: Partial<Record<SupportedAdLocale, AdTranslationQaResult>>;
  repairTargetLocales: SupportedAdLocale[];
};

export const AD_LOCALIZATION_PROMPT_VERSION = "AI_AD_LOCALIZATION_PROMPT_V1";
export const AD_LOCALIZATION_REPAIR_PROMPT_VERSION = "AI_AD_LOCALIZATION_REPAIR_PROMPT_V1";

export const AD_LOCALIZATION_FIELD_LIMITS = {
  headline: 72,
  supportingCopy: 160,
  imageAltText: 140,
} as const;

export const AD_LOCALIZATION_JSON_SCHEMA = {
  name: "ad_persuasive_transcreation",
  strict: true,
  schema: {
    type: "object",
    properties: {
      localizations: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: {
          type: "object",
          properties: {
            locale: { type: "string", enum: ["en-US", "es-US", "ko-KR"] },
            headline: { type: "string" },
            supportingCopy: { type: "string" },
            imageAltText: { type: "string" },
          },
          required: ["locale", "headline", "supportingCopy", "imageAltText"],
          additionalProperties: false,
        },
      },
    },
    required: ["localizations"],
    additionalProperties: false,
  },
} as const;

export const AD_LOCALIZATION_REPAIR_JSON_SCHEMA = {
  name: "ad_persuasive_transcreation_repair",
  strict: true,
  schema: {
    type: "object",
    properties: {
      localization: {
        type: "object",
        properties: {
          locale: { type: "string", enum: ["en-US", "es-US", "ko-KR"] },
          headline: { type: "string" },
          supportingCopy: { type: "string" },
          imageAltText: { type: "string" },
        },
        required: ["locale", "headline", "supportingCopy", "imageAltText"],
        additionalProperties: false,
      },
    },
    required: ["localization"],
    additionalProperties: false,
  },
} as const;

const SUPPORTED_LOCALES: SupportedAdLocale[] = ["en-US", "es-US", "ko-KR"];

const LOCALE_LABELS: Record<SupportedAdLocale, string> = {
  "en-US": "American English",
  "es-US": "U.S. Spanish",
  "ko-KR": "Korean",
};

const LOCALE_RULES: Record<SupportedAdLocale, string[]> = {
  "en-US": [
    "Write natural American English.",
    "Use sentence case and clear local-business language.",
  ],
  "es-US": [
    "Write natural U.S. Spanish with appropriate diacritics.",
    "Avoid literal English word order and regionally narrow slang.",
  ],
  "ko-KR": [
    "Write concise, natural Korean for a mobile local-business card.",
    "Do not infer Korean counters, particles, or transliterations for protected names.",
  ],
};

const BANNED_SHORTHAND = ["BOGO", "2-for-1", "2x1", "1+1", "Same-Item"];

export const REPAIRABLE_AD_LOCALIZATION_REASON_CODES = [
  "WRONG_LANGUAGE",
  "PROTECTED_TERM_CHANGED",
  "BANNED_SHORTHAND",
  "MOBILE_COPY_TOO_LONG",
  "UNNATURAL_TARGET_LANGUAGE",
  "INCOMPLETE_FIELDS",
  "UNEXPECTED_LANGUAGE_MIXING",
] as const;

const NON_REPAIRABLE_AD_LOCALIZATION_REASON_CODES = [
  "OFFER_FACT_DRIFT",
  "UNSUPPORTED_CLAIM",
  "MEANING_CHANGED",
] as const;

export type AdLocalizationRepairReasonCode =
  | (typeof REPAIRABLE_AD_LOCALIZATION_REASON_CODES)[number]
  | (typeof NON_REPAIRABLE_AD_LOCALIZATION_REASON_CODES)[number]
  | string;

export type AdLocalizationRepairRequest = Omit<AdLocalizationProviderRequest, "targetLocales"> & {
  targetLocale: SupportedAdLocale;
  failedCreative: AdLocalizationSourceCreative;
  reasonCodes: AdLocalizationRepairReasonCode[];
  conciseFeedback?: string[] | null;
  failedFields?: Array<"headline" | "supportingCopy" | "imageAltText"> | null;
};

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function finiteQuantity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function uniqueClean(values: readonly unknown[] | null | undefined, max = 20): string[] {
  const out: string[] = [];
  for (const value of values ?? []) {
    const clean = cleanText(value, 160);
    const key = clean.toLowerCase();
    if (!clean || out.some((existing) => existing.toLowerCase() === key)) continue;
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeTargetLocales(
  sourceLocale: SupportedAdLocale,
  targetLocales: readonly SupportedAdLocale[] | null | undefined,
): SupportedAdLocale[] {
  const out: SupportedAdLocale[] = [];
  const source = targetLocales?.length ? targetLocales : SUPPORTED_LOCALES;
  for (const locale of source) {
    if (!SUPPORTED_LOCALES.includes(locale) || locale === sourceLocale || out.includes(locale)) continue;
    out.push(locale);
  }
  return out;
}

function compactForPrompt(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return cleanText(value, 420);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((child) => compactForPrompt(child, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 120);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    out[key] = compactForPrompt(child, depth + 1);
  }
  return out;
}

function promptJson(value: unknown): string {
  return JSON.stringify(compactForPrompt(value), null, 2);
}

function noProviderResult(params: {
  promptVersion: string;
  skippedReason?: string;
  attempts?: ProviderAttempt[];
}): AdLocalizationProviderResult {
  return {
    targetCreatives: {},
    provider: "none",
    model: "none",
    fallbackUsed: false,
    skippedReason: params.skippedReason,
    attempts: params.attempts ?? [],
    promptVersion: params.promptVersion,
  };
}

function targetRulesBlock(targetLocales: readonly SupportedAdLocale[]): string {
  return targetLocales
    .map((locale) => [
      `${locale} (${LOCALE_LABELS[locale]}):`,
      ...LOCALE_RULES[locale].map((rule) => `- ${rule}`),
    ].join("\n"))
    .join("\n\n");
}

export function adLocalizationOfferFactsFromDefinition(
  definition: OfferDefinitionForLocalization,
): AdLocalizationOfferFacts {
  return {
    merchantName: cleanText(definition.merchantName, 160),
    locationName: cleanText(definition.locationName, 160),
    offerType: cleanText(definition.offerType, 80),
    paidItems: (definition.qualifyingItems ?? []).map((item) => ({
      displayName: cleanText(item.displayName, 160),
      quantity: finiteQuantity(item.quantity),
    })).filter((item) => item.displayName),
    reward: {
      rule: cleanText(definition.reward?.rule, 80),
      displayNames: uniqueClean(definition.reward?.displayNames ?? []),
      quantity: finiteQuantity(definition.reward?.quantity),
      discountPercent: finiteQuantity(definition.reward?.discountPercent),
    },
    scheduleSummary: cleanText(definition.schedule?.summary, 220) || null,
    totalClaimLimit:
      typeof definition.totalClaimLimit === "number" && Number.isFinite(definition.totalClaimLimit)
        ? Math.max(0, Math.floor(definition.totalClaimLimit))
        : null,
    redemptionLocationName: cleanText(definition.redemption?.redeemAtLocationName, 160) || null,
  };
}

export function buildAdLocalizationPrompt(input: AdLocalizationProviderRequest): {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: typeof AD_LOCALIZATION_JSON_SCHEMA;
  targetLocales: SupportedAdLocale[];
} {
  const targetLocales = normalizeTargetLocales(input.sourceLocale, input.targetLocales);
  const protectedTerms = uniqueClean(input.protectedTerms);
  return {
    targetLocales,
    jsonSchema: AD_LOCALIZATION_JSON_SCHEMA,
    systemPrompt: [
      `Prompt version: ${AD_LOCALIZATION_PROMPT_VERSION}.`,
      "You transcreate persuasive ad fields for Twofer, a mobile app for local business deals.",
      "The source creative is already selected. Transcreate only that winning source creative into the requested target locales.",
      "Return exactly one localization object for each requested target locale and never return the source locale.",
      "The model must not author exact offer lines, terms, price, time, quantity mechanics, CTA, eligibility, inventory, or redemption instructions.",
      "Exact mechanics are rendered elsewhere from structured offer facts; use those facts only as guardrails to avoid drift.",
      "Preserve protected merchant names, business names, branded item names, and exact item names character-for-character.",
      "Do not add claims, ingredients, ratings, guarantees, dietary claims, popularity claims, price claims, or urgency.",
      "Avoid word-for-word translation when it sounds unnatural. Preserve the source idea, tone, and customer moment.",
      `Field limits: headline <= ${AD_LOCALIZATION_FIELD_LIMITS.headline} chars, supportingCopy <= ${AD_LOCALIZATION_FIELD_LIMITS.supportingCopy} chars, imageAltText <= ${AD_LOCALIZATION_FIELD_LIMITS.imageAltText} chars.`,
      `Banned shorthand in every locale: ${BANNED_SHORTHAND.join(", ")}.`,
      "Return JSON only and follow the schema exactly.",
    ].join("\n"),
    userPrompt: [
      `Ad version id: ${cleanText(input.adVersionId, 120) || "unknown"}`,
      `Source locale: ${input.sourceLocale} (${LOCALE_LABELS[input.sourceLocale]}).`,
      `Target locales: ${targetLocales.map((locale) => `${locale} (${LOCALE_LABELS[locale]})`).join(", ") || "(none)"}.`,
      "",
      "TARGET LOCALE RULES:",
      targetRulesBlock(targetLocales),
      "",
      "PROTECTED TERMS TO PRESERVE EXACTLY:",
      protectedTerms.length ? protectedTerms.map((term) => `- ${term}`).join("\n") : "- (none supplied)",
      "",
      "SOURCE CREATIVE:",
      promptJson({
        strategy: cleanText(input.sourceCreative.strategy, 120),
        headline: cleanText(input.sourceCreative.headline, AD_LOCALIZATION_FIELD_LIMITS.headline),
        supportingCopy: cleanText(input.sourceCreative.supportingCopy, AD_LOCALIZATION_FIELD_LIMITS.supportingCopy),
        imageAltText: cleanText(input.sourceCreative.imageAltText, AD_LOCALIZATION_FIELD_LIMITS.imageAltText),
      }),
      "",
      "CREATIVE BRIEF:",
      promptJson(input.creativeBrief ?? {}),
      "",
      "IMMUTABLE OFFER FACTS FOR GUARDRAILS ONLY:",
      promptJson(input.offerFacts),
      "",
      "LOCALIZED TERM SNAPSHOT OR REVIEW CONTEXT:",
      promptJson(input.localizedTerms ?? []),
      "",
      "MERCHANT CREATIVE PROFILE:",
      promptJson(input.merchantProfile ?? {}),
      "",
      "Output only headline, supportingCopy, and imageAltText for each target locale.",
    ].join("\n"),
  };
}

export function isRepairableAdLocalizationFailure(reasonCodes: readonly AdLocalizationRepairReasonCode[]): boolean {
  if (reasonCodes.length === 0) return false;
  return reasonCodes.every((reason) =>
    (REPAIRABLE_AD_LOCALIZATION_REASON_CODES as readonly string[]).includes(reason)
  );
}

export function buildAdLocalizationRepairPrompt(input: AdLocalizationRepairRequest): {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: typeof AD_LOCALIZATION_REPAIR_JSON_SCHEMA;
  repairable: boolean;
  skippedReason?: string;
} {
  const targetLocale = input.targetLocale;
  const protectedTerms = uniqueClean(input.protectedTerms);
  if (targetLocale === input.sourceLocale) {
    return {
      repairable: false,
      skippedReason: "SOURCE_LOCALE_REPAIR_NOT_ALLOWED",
      jsonSchema: AD_LOCALIZATION_REPAIR_JSON_SCHEMA,
      systemPrompt: "",
      userPrompt: "",
    };
  }
  if (!isRepairableAdLocalizationFailure(input.reasonCodes)) {
    return {
      repairable: false,
      skippedReason: "NON_REPAIRABLE_QA_FAILURE",
      jsonSchema: AD_LOCALIZATION_REPAIR_JSON_SCHEMA,
      systemPrompt: "",
      userPrompt: "",
    };
  }

  return {
    repairable: true,
    jsonSchema: AD_LOCALIZATION_REPAIR_JSON_SCHEMA,
    systemPrompt: [
      `Prompt version: ${AD_LOCALIZATION_REPAIR_PROMPT_VERSION}.`,
      "You repair one failed target-locale persuasive ad localization for Twofer.",
      "Repair only the requested target locale. Do not generate, mention, or alter any passing locale.",
      "Return exactly one localization object for the requested target locale.",
      "Use the QA feedback to fix only language, protected-term preservation, banned shorthand, mobile length, field completeness, or language-mixing issues.",
      "If the previous target copy included a fact drift, unsupported claim, or changed meaning, this repair prompt should not have been called; do not preserve that defect.",
      "The model must not author exact offer lines, terms, price, time, quantity mechanics, CTA, eligibility, inventory, or redemption instructions.",
      "Preserve protected merchant names, business names, branded item names, and exact item names character-for-character.",
      "Do not add claims, ingredients, ratings, guarantees, dietary claims, popularity claims, price claims, or urgency.",
      `Field limits: headline <= ${AD_LOCALIZATION_FIELD_LIMITS.headline} chars, supportingCopy <= ${AD_LOCALIZATION_FIELD_LIMITS.supportingCopy} chars, imageAltText <= ${AD_LOCALIZATION_FIELD_LIMITS.imageAltText} chars.`,
      `Banned shorthand in every locale: ${BANNED_SHORTHAND.join(", ")}.`,
      "Return JSON only and follow the schema exactly.",
    ].join("\n"),
    userPrompt: [
      `Ad version id: ${cleanText(input.adVersionId, 120) || "unknown"}`,
      `Source locale: ${input.sourceLocale} (${LOCALE_LABELS[input.sourceLocale]}).`,
      `Repair target locale: ${targetLocale} (${LOCALE_LABELS[targetLocale]}).`,
      "",
      "TARGET LOCALE RULES:",
      targetRulesBlock([targetLocale]),
      "",
      "QA REASONS TO REPAIR:",
      uniqueClean(input.reasonCodes, 12).map((reason) => `- ${reason}`).join("\n"),
      "",
      "QA FEEDBACK:",
      uniqueClean(input.conciseFeedback ?? [], 12).map((feedback) => `- ${feedback}`).join("\n") || "- (none supplied)",
      "",
      "FAILED FIELDS:",
      uniqueClean(input.failedFields ?? [], 3).map((field) => `- ${field}`).join("\n") || "- (not specified)",
      "",
      "PROTECTED TERMS TO PRESERVE EXACTLY:",
      protectedTerms.length ? protectedTerms.map((term) => `- ${term}`).join("\n") : "- (none supplied)",
      "",
      "SOURCE CREATIVE:",
      promptJson({
        strategy: cleanText(input.sourceCreative.strategy, 120),
        headline: cleanText(input.sourceCreative.headline, AD_LOCALIZATION_FIELD_LIMITS.headline),
        supportingCopy: cleanText(input.sourceCreative.supportingCopy, AD_LOCALIZATION_FIELD_LIMITS.supportingCopy),
        imageAltText: cleanText(input.sourceCreative.imageAltText, AD_LOCALIZATION_FIELD_LIMITS.imageAltText),
      }),
      "",
      "FAILED TARGET CREATIVE TO REPAIR:",
      promptJson({
        headline: cleanText(input.failedCreative.headline, AD_LOCALIZATION_FIELD_LIMITS.headline + 80),
        supportingCopy: cleanText(input.failedCreative.supportingCopy, AD_LOCALIZATION_FIELD_LIMITS.supportingCopy + 120),
        imageAltText: cleanText(input.failedCreative.imageAltText, AD_LOCALIZATION_FIELD_LIMITS.imageAltText + 80),
      }),
      "",
      "CREATIVE BRIEF:",
      promptJson(input.creativeBrief ?? {}),
      "",
      "IMMUTABLE OFFER FACTS FOR GUARDRAILS ONLY:",
      promptJson(input.offerFacts),
      "",
      "LOCALIZED TERM SNAPSHOT OR REVIEW CONTEXT:",
      promptJson(input.localizedTerms ?? []),
      "",
      "MERCHANT CREATIVE PROFILE:",
      promptJson(input.merchantProfile ?? {}),
      "",
      "Output only repaired headline, supportingCopy, and imageAltText for the repair target locale.",
    ].join("\n"),
  };
}

function normalizeProviderValue(
  value: unknown,
  targetLocales: readonly SupportedAdLocale[],
): Partial<Record<SupportedAdLocale, AdLocalizationProviderCreative>> {
  const localizations = (value as { localizations?: unknown[] } | null)?.localizations;
  if (!Array.isArray(localizations)) return {};
  const targetSet = new Set(targetLocales);
  const out: Partial<Record<SupportedAdLocale, AdLocalizationProviderCreative>> = {};
  for (const item of localizations) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const locale = record.locale;
    if (!SUPPORTED_LOCALES.includes(locale as SupportedAdLocale)) continue;
    const supportedLocale = locale as SupportedAdLocale;
    if (!targetSet.has(supportedLocale) || out[supportedLocale]) continue;
    out[supportedLocale] = {
      locale: supportedLocale,
      headline: cleanText(record.headline, AD_LOCALIZATION_FIELD_LIMITS.headline),
      supportingCopy: cleanText(record.supportingCopy, AD_LOCALIZATION_FIELD_LIMITS.supportingCopy),
      imageAltText: cleanText(record.imageAltText, AD_LOCALIZATION_FIELD_LIMITS.imageAltText),
    };
  }
  return out;
}

function normalizeProviderRepairValue(
  value: unknown,
  targetLocale: SupportedAdLocale,
): Partial<Record<SupportedAdLocale, AdLocalizationProviderCreative>> {
  const localization = (value as { localization?: unknown } | null)?.localization;
  const record = localization && typeof localization === "object" ? localization as Record<string, unknown> : {};
  if (record.locale !== targetLocale) return {};
  return {
    [targetLocale]: {
      locale: targetLocale,
      headline: cleanText(record.headline, AD_LOCALIZATION_FIELD_LIMITS.headline),
      supportingCopy: cleanText(record.supportingCopy, AD_LOCALIZATION_FIELD_LIMITS.supportingCopy),
      imageAltText: cleanText(record.imageAltText, AD_LOCALIZATION_FIELD_LIMITS.imageAltText),
    },
  };
}

export async function generateAdLocalizationTranscreations(
  request: AdLocalizationProviderRequest,
  deps: AiTextProviderDeps,
): Promise<AdLocalizationProviderResult> {
  const prompt = buildAdLocalizationPrompt(request);
  if (prompt.targetLocales.length === 0) {
    return {
      targetCreatives: {},
      provider: "none",
      model: "none",
      fallbackUsed: false,
      attempts: [],
      promptVersion: AD_LOCALIZATION_PROMPT_VERSION,
    };
  }

  const generation = await generateStructuredText<typeof AD_LOCALIZATION_JSON_SCHEMA, unknown>({
    operation: "translation",
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    jsonSchema: prompt.jsonSchema,
    maxOutputTokens: 950,
    timeoutMs: 12_000,
    generationRunId: request.generationRunId,
    promptVersion: AD_LOCALIZATION_PROMPT_VERSION,
    reasoningLevel: "medium",
  }, {
    ...deps,
    config: deps.config ?? resolveAiTextProviderConfig(deps.env),
  });

  return {
    targetCreatives: normalizeProviderValue(generation.value, prompt.targetLocales),
    provider: generation.provider,
    model: generation.model,
    fallbackUsed: generation.fallbackUsed,
    fallbackReason: generation.fallbackReason,
    attempts: generation.attempts,
    promptVersion: AD_LOCALIZATION_PROMPT_VERSION,
  };
}

export async function repairAdLocalizationTranscreation(
  request: AdLocalizationRepairRequest,
  deps: AiTextProviderDeps,
): Promise<AdLocalizationProviderResult> {
  const prompt = buildAdLocalizationRepairPrompt(request);
  if (!prompt.repairable) {
    return noProviderResult({
      promptVersion: AD_LOCALIZATION_REPAIR_PROMPT_VERSION,
      skippedReason: prompt.skippedReason ?? "REPAIR_SKIPPED",
    });
  }

  const generation = await generateStructuredText<typeof AD_LOCALIZATION_REPAIR_JSON_SCHEMA, unknown>({
    operation: "translation",
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    jsonSchema: prompt.jsonSchema,
    maxOutputTokens: 550,
    timeoutMs: 10_000,
    generationRunId: request.generationRunId,
    promptVersion: AD_LOCALIZATION_REPAIR_PROMPT_VERSION,
    reasoningLevel: "medium",
  }, {
    ...deps,
    config: deps.config ?? resolveAiTextProviderConfig(deps.env),
  });

  return {
    targetCreatives: normalizeProviderRepairValue(generation.value, request.targetLocale),
    provider: generation.provider,
    model: generation.model,
    fallbackUsed: generation.fallbackUsed,
    fallbackReason: generation.fallbackReason,
    attempts: generation.attempts,
    promptVersion: AD_LOCALIZATION_REPAIR_PROMPT_VERSION,
  };
}

function providerCreativeToSourceCreative(
  creative: AdLocalizationProviderCreative | AdLocalizationSourceCreative | null | undefined,
): SourceAdCreative {
  return {
    headline: cleanText(creative?.headline, AD_LOCALIZATION_FIELD_LIMITS.headline),
    supportingCopy: cleanText(creative?.supportingCopy, AD_LOCALIZATION_FIELD_LIMITS.supportingCopy),
    imageAltText: cleanText(creative?.imageAltText, AD_LOCALIZATION_FIELD_LIMITS.imageAltText),
  };
}

function failedFieldsForQa(input: {
  sourceCreative: SourceAdCreative;
  targetCreative: SourceAdCreative;
  qa: AdTranslationQaResult;
}): Array<"headline" | "supportingCopy" | "imageAltText"> {
  const fields: Array<"headline" | "supportingCopy" | "imageAltText"> = [];
  if (
    input.qa.hardFailReasons.includes("INCOMPLETE_FIELDS") ||
    input.qa.hardFailReasons.includes("WRONG_LANGUAGE") ||
    input.qa.hardFailReasons.includes("BANNED_SHORTHAND") ||
    input.qa.hardFailReasons.includes("UNNATURAL_TARGET_LANGUAGE") ||
    input.qa.hardFailReasons.includes("UNEXPECTED_LANGUAGE_MIXING") ||
    input.qa.hardFailReasons.includes("PROTECTED_TERM_CHANGED")
  ) {
    fields.push("headline", "supportingCopy", "imageAltText");
  }
  if (
    cleanText(input.targetCreative.headline).length > AD_TRANSLATION_FIELD_LIMITS.headline &&
    !fields.includes("headline")
  ) {
    fields.push("headline");
  }
  if (
    cleanText(input.targetCreative.supportingCopy).length > AD_TRANSLATION_FIELD_LIMITS.supportingCopy &&
    !fields.includes("supportingCopy")
  ) {
    fields.push("supportingCopy");
  }
  if (
    cleanText(input.targetCreative.imageAltText).length > AD_TRANSLATION_FIELD_LIMITS.imageAltText &&
    !fields.includes("imageAltText")
  ) {
    fields.push("imageAltText");
  }
  return fields.length ? fields : ["headline", "supportingCopy", "imageAltText"];
}

export async function generateVerifiedAdLocalizationBundle(input: {
  request: AdLocalizationProviderRequest;
  offerDefinition: OfferDefinitionV1;
  deps: AiTextProviderDeps;
  providerEnabled: boolean;
  repairEnabled: boolean;
}): Promise<VerifiedAdLocalizationBundleResult> {
  const sourceCreative = providerCreativeToSourceCreative(input.request.sourceCreative);
  let transcreation: AdLocalizationProviderResult = noProviderResult({
    promptVersion: AD_LOCALIZATION_PROMPT_VERSION,
    skippedReason: input.providerEnabled ? "TRANSCREATION_NOT_RUN" : "TRANSCREATION_FLAG_DISABLED",
  });

  if (input.providerEnabled) {
    try {
      transcreation = await generateAdLocalizationTranscreations(input.request, input.deps);
    } catch (error) {
      transcreation = noProviderResult({
        promptVersion: AD_LOCALIZATION_PROMPT_VERSION,
        skippedReason: "TRANSCREATION_PROVIDER_FAILED",
        attempts: (error as { attempts?: ProviderAttempt[] } | null)?.attempts ?? [],
      });
    }
  }

  const targetCreatives: Partial<Record<SupportedAdLocale, SourceAdCreative>> = {};
  const repairedTargetCreatives: Partial<Record<SupportedAdLocale, SourceAdCreative>> = {};
  const deterministicQa: Partial<Record<SupportedAdLocale, AdTranslationQaResult>> = {};
  const repairs: Partial<Record<SupportedAdLocale, AdLocalizationProviderResult>> = {};
  const repairTargetLocales: SupportedAdLocale[] = [];

  for (const locale of normalizeTargetLocales(input.request.sourceLocale, input.request.targetLocales)) {
    const targetCreative = transcreation.targetCreatives[locale];
    if (!targetCreative) continue;

    const normalizedTarget = providerCreativeToSourceCreative(targetCreative);
    targetCreatives[locale] = normalizedTarget;
    const qa = validateAdTranscreationDeterministically({
      sourceLocale: input.request.sourceLocale,
      targetLocale: locale,
      sourceCreative,
      targetCreative: normalizedTarget,
      offerDefinition: input.offerDefinition,
      protectedTerms: input.request.protectedTerms,
    });
    deterministicQa[locale] = qa;

    if (!input.repairEnabled || qa.decision !== "repair") continue;
    repairTargetLocales.push(locale);
    try {
      const repair = await repairAdLocalizationTranscreation({
        ...input.request,
        targetLocale: locale,
        failedCreative: normalizedTarget,
        reasonCodes: qa.hardFailReasons,
        conciseFeedback: qa.conciseFeedback,
        failedFields: failedFieldsForQa({
          sourceCreative,
          targetCreative: normalizedTarget,
          qa,
        }),
      }, input.deps);
      repairs[locale] = repair;
      const repaired = repair.targetCreatives[locale];
      if (repaired) repairedTargetCreatives[locale] = providerCreativeToSourceCreative(repaired);
    } catch (error) {
      repairs[locale] = noProviderResult({
        promptVersion: AD_LOCALIZATION_REPAIR_PROMPT_VERSION,
        skippedReason: "REPAIR_PROVIDER_FAILED",
        attempts: (error as { attempts?: ProviderAttempt[] } | null)?.attempts ?? [],
      });
    }
  }

  const bundle = buildQaCheckedAdLocalizationBundle({
    sourceLocale: input.request.sourceLocale,
    sourceCreative,
    offerDefinition: input.offerDefinition,
    protectedTerms: input.request.protectedTerms,
    targetCreatives,
    repairedTargetCreatives,
  });

  return {
    bundle,
    transcreation,
    repairs,
    deterministicQa,
    repairTargetLocales,
  };
}
