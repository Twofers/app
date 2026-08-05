/**
 * Pure, I/O-free helpers for the flag-gated Admin AI quality pass
 * (ADMIN_AI_V2_ENABLED). Everything here is a plain function over plain data
 * so it can be unit-tested with vitest under node, with no Deno global and no
 * network access. The orchestration that actually calls a provider (prompt
 * assembly + provider calls + re-asks) lives in admin-ai.ts, which imports
 * from this module.
 *
 * Flag default is OFF: every exported "V2" builder below is additive text
 * that admin-ai.ts only appends when adminAiV2Enabled() is true. Nothing here
 * mutates or replaces the always-on generic prompt in adminAiSystemPrompt.
 */

import type { AdminAiFeature } from "./admin-ai.ts";

// ---------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------

/**
 * Reads ADMIN_AI_V2_ENABLED from the edge-runtime env only. Returns false
 * under vitest/node (no `Deno` global) and whenever unset, so every V2 code
 * path stays dark by default. `typeof Deno` never throws for an undeclared
 * identifier, so this is safe to call from a unit-tested pure function (same
 * pattern as openai-fetch.ts's edgeEnvOrNull and site-import.ts's
 * menuTextV2FlagEnabled).
 */
export function adminAiV2Enabled(): boolean {
  try {
    return typeof Deno !== "undefined" && Deno.env.get("ADMIN_AI_V2_ENABLED") === "true";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Banned public-copy phrases (named explicitly, with preferred replacements)
// ---------------------------------------------------------------------------

/**
 * V2-only addition to the system prompt: names the exact terms the sanitizer
 * (BANNED_PUBLIC_COPY_PATTERNS in admin-ai.ts) blind-replaces, and gives the
 * model the same merchant-safe vocabulary the generic prompt already lists,
 * so the model avoids the terms itself instead of relying on a post-hoc
 * string replace that can mangle grammar.
 */
export function bannedPhraseGuardrailSection(): string {
  return [
    "Never write the exact terms \"BOGO\", \"2-for-1\", \"2 for 1\", or \"2x1\" in any field a merchant, prospect, or customer will read.",
    "If the underlying mechanic is a two-item or percent-off offer, describe it instead as a Twofer deal, local offer, limited-time offer, paired offer, or bonus item offer.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Feature-specific system prompt sections
// ---------------------------------------------------------------------------

/** Twofer's trial terms, copied verbatim from admin-trial-conversion-assistant/index.ts's trial_limits payload so sales_script and trial_conversion_assistant never drift apart. */
export const TWOFER_TRIAL_FACTS = {
  trialDays: 90,
  limited: { offerLimit: 1, claimLimit: 25 },
  full: { offerLimit: 3, claimLimit: 50 },
} as const;

function trialFactsSentence(): string {
  return `The Twofer founding trial runs ${TWOFER_TRIAL_FACTS.trialDays} days. The limited plan allows ${TWOFER_TRIAL_FACTS.limited.offerLimit} offer and up to ${TWOFER_TRIAL_FACTS.limited.claimLimit} claims; the full plan allows ${TWOFER_TRIAL_FACTS.full.offerLimit} offers and up to ${TWOFER_TRIAL_FACTS.full.claimLimit} claims. Never state a different trial length, offer count, or claim cap.`;
}

const SALES_SCRIPT_EXAMPLE_PITCH =
  "Example 30-second pitch (tone: founder-led): \"Hi, I'm with Twofer. We're inviting a small group of local businesses to try a founding trial — no cost, no commitment. You pick a limited-time local offer during a slower window, and we bring in nearby customers who are already looking for something like you. Nothing goes live until you review and approve it. Would it be okay if I sent a secure claim link so you can take a look?\"";

/** Feature-specific system prompt section for "sales_script". */
export function salesScriptPromptSection(): string {
  return [
    "Feature-specific rules for sales_script:",
    "Tone definitions: \"direct\" is brief and to the point with no small talk; \"friendly\" is warm and conversational; \"professional\" is formal and business-like; \"founder-led\" speaks personally as the Twofer founder reaching out directly.",
    "Word-count limits: in_person_30_second_pitch and demo_pitch each stay under about 90 spoken words (roughly 30 seconds aloud); follow_up_email body stays under about 180 words; follow_up_sms stays under 300 characters; each objection_responses.response stays under about 40 words.",
    SALES_SCRIPT_EXAMPLE_PITCH,
    trialFactsSentence(),
  ].join("\n");
}

/**
 * Feature-specific system prompt section for "onboarding_review". Decision
 * criteria mirror fallbackReview() in admin-onboarding-review-ai/index.ts
 * (read-only reference; that file is not edited by this change) so the AI
 * recommendation and the deterministic fallback reason about the same rules.
 */
export function onboardingReviewPromptSection(): string {
  return [
    "Feature-specific rules for onboarding_review:",
    "Check for these fields before recommending approval: contact name, owner email, business type, address, slow hours, offer interests.",
    "If more than 2 of those fields are missing, or the application's deterministic risk_score is below 40, recommend \"needs manual review\" rather than \"approve setup access\".",
    "Flag a possible duplicate business whenever a supplied duplicate_candidates entry or an already-linked business record matches the applicant's business name.",
    "This recommendation is advisory only: an admin must click to approve, reject, or waitlist. Never imply the application has already been approved, billed, or made live.",
  ].join("\n");
}

/** Feature-specific system prompt section for "prospect_enrichment". */
export function prospectEnrichmentPromptSection(): string {
  return [
    "Feature-specific rules for prospect_enrichment:",
    "State only facts that are present in the supplied source content (stored source notes and any fetched source content blocks). Mark everything else as unverified rather than inferring or guessing it.",
    "Only cite a source in the sources field when its content was actually supplied to you (a stored source note or a \"Fetched source content:\" block). Never invent or cite a URL you were not given.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Prospect-scoring rubric (shared between the system prompt and the schema)
// ---------------------------------------------------------------------------

export type ScoreComponentRange = { min: number; max: number };

/**
 * Verified against buildDeterministicScore() and its helpers in
 * admin-prospect-score/index.ts (read-only reference; not edited by this
 * change):
 *  - demand: Math.min(20, ...) with all-positive terms -> 0 to 20.
 *  - category_fit (categoryScore): returns 6, 12, or 18 -> 6 to 18.
 *  - geography (geographyScore): returns 4, 10, or 16 -> 4 to 16.
 *  - business_type: 2 (chain/franchise/national) or 10 otherwise -> 2 to 10.
 *  - slow_period_fit: 5 or 10 -> 5 to 10.
 *  - source_confidence: 2 when stale, else Math.round(confidence(0-1) * 10) -> 0 to 10.
 *  - sales_readiness (stored value is salesReadiness + reviewBonus): salesReadiness
 *    is 3, 7, or 12; reviewBonus is 0 or 8 -> 3 to 20.
 *  - duplicate_risk: -35 or 0 -> -35 to 0.
 * total_score is clamped 0-100 by clampScore() regardless of component sum.
 */
export const SCORE_COMPONENT_RANGES: Record<string, ScoreComponentRange> = {
  demand: { min: 0, max: 20 },
  category_fit: { min: 6, max: 18 },
  geography: { min: 4, max: 16 },
  business_type: { min: 2, max: 10 },
  slow_period_fit: { min: 5, max: 10 },
  source_confidence: { min: 0, max: 10 },
  sales_readiness: { min: 3, max: 20 },
  duplicate_risk: { min: -35, max: 0 },
};

export const SCORE_TOTAL_RANGE: ScoreComponentRange = { min: 0, max: 100 };

/** Feature-specific system prompt section for "prospect_scoring": the rubric. */
export function prospectScoringPromptSection(): string {
  const lines = Object.entries(SCORE_COMPONENT_RANGES).map(
    ([key, range]) => `${key}: ${range.min} to ${range.max}`,
  );
  return [
    "Feature-specific rules for prospect_scoring:",
    "score_components ranges (each component must stay within its range):",
    ...lines,
    `total_score: ${SCORE_TOTAL_RANGE.min} to ${SCORE_TOTAL_RANGE.max}.`,
    "A deterministic baseline score is supplied in the prompt as baseline_score. Start from it and adjust each component only where the supplied prospect, demand, source, or enrichment data gives you a specific reason to differ from the baseline. Explain any adjustment in reason_summary.",
  ].join("\n");
}

/** Composes the full feature-specific section (or "" when a feature has none). */
export function featureSystemPromptSection(feature: AdminAiFeature): string {
  if (feature === "sales_script") return salesScriptPromptSection();
  if (feature === "onboarding_review") return onboardingReviewPromptSection();
  if (feature === "prospect_enrichment") return prospectEnrichmentPromptSection();
  if (feature === "prospect_scoring") return prospectScoringPromptSection();
  return "";
}

// ---------------------------------------------------------------------------
// Field classification for the banned-phrase rewrite re-ask
// ---------------------------------------------------------------------------

/**
 * Field names that hold admin-only / internal notes rather than copy a
 * merchant, prospect, or customer will read. The banned-phrase rewrite re-ask
 * (admin-ai.ts sanitizeOutputV2Async) is skipped for these — a blind string
 * replace there is cheap and low-stakes, and spending a provider call to
 * "improve the grammar" of an internal note is not worth the latency/cost.
 */
const INTERNAL_ONLY_FIELD_NAMES = new Set([
  "warnings",
  "sources",
  "source_notes",
  "risk_notes",
  "risk_flags",
  "missing_information",
  "missing_fields",
  "red_flags",
  "internal_notes",
  "internal_risk_notes",
  "caveats",
  "reason_summary",
  "review_status",
  "label",
  "notes",
  "url",
  "score_components",
  "tier",
  "provider",
  "model",
  "prompt_version",
]);

export function isInternalOnlyFieldName(fieldName: string | null | undefined): boolean {
  if (!fieldName) return false;
  return INTERNAL_ONLY_FIELD_NAMES.has(fieldName);
}

export function isPublicFacingFieldName(fieldName: string | null | undefined): boolean {
  if (!fieldName) return false;
  return !isInternalOnlyFieldName(fieldName);
}

// ---------------------------------------------------------------------------
// Required-keys maps (feature output shape, excluding the shared envelope)
// ---------------------------------------------------------------------------

/**
 * Fields generateAdminAiJson() always synthesizes onto every output
 * (AdminAiOutputBase in admin-ai.ts), regardless of what a custom
 * output_schema declares. Excluded from the required-keys maps below because
 * they are never actually load-bearing on a custom schema.
 */
export const ADMIN_AI_ENVELOPE_KEYS: readonly string[] = [
  "confidence",
  "sources",
  "warnings",
  "review_status",
  "generated_at",
  "model",
  "provider",
  "prompt_version",
  "requires_human_review",
  "safe_for_public_display",
];

/**
 * Per-feature required keys, derived from each endpoint's own default JSON
 * schema `required` array (read-only reference; none of those schema
 * constants are edited by this change), minus the envelope keys above. Used
 * by (a) the admin-ai-prompts upsert/activate schema-compatibility check and
 * (b) the admin-ai-prompts "test" action's validation result.
 */
export const ADMIN_AI_FEATURE_REQUIRED_KEYS: Record<AdminAiFeature, string[]> = {
  prospect_enrichment: [
    "cleaned_business_name",
    "likely_business_category",
    "short_business_summary",
    "likely_best_customer_segment",
    "likely_slow_period_hypothesis",
    "possible_promotable_items",
    "suggested_first_limited_time_local_offer_ideas",
    "website_social_summary",
    "missing_information",
    "red_flags",
    "source_notes",
  ],
  prospect_scoring: [
    "total_score",
    "tier",
    "score_components",
    "recommended_next_action",
    "reason_summary",
    "risk_notes",
  ],
  demand_proof: [
    "merchant_safe_summary",
    "suggested_pitch",
    "suggested_first_offer_window",
    "suggested_offer_structure",
    "what_to_say_in_person",
    "what_not_to_say",
    "privacy_safe_stats",
    "email_pitch",
    "sms_pitch",
    "owner_summary",
    "internal_notes",
    "caveats",
  ],
  sales_script: [
    "in_person_30_second_pitch",
    "demo_pitch",
    "follow_up_email",
    "follow_up_sms",
    "objection_responses",
    "suggested_first_offer",
    "suggested_next_action",
    "tone",
  ],
  onboarding_review: [
    "application_summary",
    "missing_fields",
    "possible_duplicate_business",
    "risk_flags",
    "recommended_approval_path",
    "suggested_admin_note",
    "suggested_next_email",
    "suggested_follow_up",
  ],
  claim_link_assistant: [
    "claim_link_intro_copy",
    "owner_instructions",
    "owner_needs_to_verify",
    "after_claim_explanation",
    "internal_risk_notes",
    "recommended_expiration_days",
    "recommended_follow_up_date",
  ],
  trial_conversion_assistant: [
    "recommended_trial_type",
    "setup_checklist",
    "missing_information",
    "suggested_first_three_offer_ideas",
    "suggested_first_slow_hour_window",
    "suggested_owner_onboarding_email",
    "suggested_staff_instruction_card",
    "risk_notes",
  ],
  owner_email: ["subject", "body"],
  operating_report: ["founder_summary", "recommended_next_actions", "risks_to_watch"],
};

/**
 * String-typed required fields, per feature, that are safe to check for
 * "present but empty" after a parse (used by the V2 completeness re-ask in
 * admin-ai.ts). Scoped to the two features the token-budget bump applies to;
 * every other feature is left exactly as before.
 */
export const ADMIN_AI_V2_REQUIRED_STRING_FIELDS: Partial<Record<AdminAiFeature, string[]>> = {
  sales_script: [
    "in_person_30_second_pitch",
    "demo_pitch",
    "follow_up_email",
    "follow_up_sms",
    "suggested_first_offer",
    "suggested_next_action",
    "tone",
  ],
  trial_conversion_assistant: [
    "recommended_trial_type",
    "suggested_first_slow_hour_window",
    "suggested_owner_onboarding_email",
    "suggested_staff_instruction_card",
  ],
};

/** Feature -> explicit maxOutputTokens the V2 token-budget bump applies. Every other feature keeps the existing 1100 default. */
export const ADMIN_AI_V2_MAX_OUTPUT_TOKENS: Partial<Record<AdminAiFeature, number>> = {
  sales_script: 2400,
  trial_conversion_assistant: 2400,
};

/**
 * Returns the required string fields (from ADMIN_AI_V2_REQUIRED_STRING_FIELDS)
 * that are missing or blank (empty/whitespace-only) on `output`. Pure; used
 * for both the completeness re-ask decision and its "did the retry fix it"
 * check.
 */
export function findEmptyRequiredStringFields(
  output: Record<string, unknown> | null | undefined,
  requiredFields: readonly string[],
): string[] {
  if (!output) return [...requiredFields];
  return requiredFields.filter((field) => {
    const value = output[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
}

/**
 * Validates that a candidate/custom output_schema (the {name, strict, schema:
 * {..., required: [...]}} shape stored in admin_ai_prompts.output_schema and
 * passed as jsonSchema to generateAdminAiJson) still declares every
 * load-bearing key for `feature`. An empty/missing schema (the "use the
 * feature's default schema" case) always passes — there is nothing to
 * validate. Returns the list of missing keys (empty = compatible).
 */
export function findMissingRequiredKeysInSchema(
  feature: AdminAiFeature,
  outputSchema: unknown,
): string[] {
  const required = ADMIN_AI_FEATURE_REQUIRED_KEYS[feature] ?? [];
  if (!required.length) return [];
  if (!outputSchema || typeof outputSchema !== "object") return [];
  const record = outputSchema as Record<string, unknown>;
  if (Object.keys(record).length === 0) return [];
  const schemaNode = record.schema && typeof record.schema === "object"
    ? record.schema as Record<string, unknown>
    : record;
  const declaredRaw = Array.isArray(schemaNode.required) ? schemaNode.required : [];
  const declared = new Set(declaredRaw.filter((key): key is string => typeof key === "string"));
  return required.filter((key) => !declared.has(key));
}
