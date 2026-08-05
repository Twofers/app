import {
  generateStructuredText,
  type AiOperation,
  type ProviderAttempt,
} from "./ai-text-provider.ts";
import { logAiCost } from "./ai-costs.ts";
import {
  sha256Hex,
  type AdminContext,
} from "./admin-prospects.ts";
import {
  ADMIN_AI_V2_MAX_OUTPUT_TOKENS,
  ADMIN_AI_V2_REQUIRED_STRING_FIELDS,
  adminAiV2Enabled,
  bannedPhraseGuardrailSection,
  featureSystemPromptSection,
  findEmptyRequiredStringFields,
  isPublicFacingFieldName,
} from "./admin-ai-v2.ts";

export type AdminAiReviewStatus =
  | "needs_review"
  | "approved"
  | "rejected"
  | "superseded";

export type AdminAiSourceNote = {
  label: string;
  url?: string | null;
  notes?: string | null;
};

export type AdminAiOutputBase = {
  confidence: number;
  sources: AdminAiSourceNote[];
  warnings: string[];
  review_status: AdminAiReviewStatus;
  generated_at: string;
  model: string;
  provider: string;
  prompt_version: string;
  requires_human_review: boolean;
  safe_for_public_display: boolean;
};

export type AdminAiFeature =
  | "prospect_enrichment"
  | "prospect_scoring"
  | "demand_proof"
  | "sales_script"
  | "onboarding_review"
  | "claim_link_assistant"
  | "trial_conversion_assistant"
  | "owner_email"
  | "operating_report";

export const ADMIN_AI_PROMPT_VERSIONS: Record<AdminAiFeature, string> = {
  prospect_enrichment: "admin-prospect-enrichment-v1",
  prospect_scoring: "admin-prospect-score-v1",
  demand_proof: "admin-demand-proof-v1",
  sales_script: "admin-sales-script-v1",
  onboarding_review: "admin-onboarding-review-v1",
  claim_link_assistant: "admin-claim-link-assistant-v1",
  trial_conversion_assistant: "admin-trial-conversion-assistant-v1",
  owner_email: "admin-owner-email-v1",
  operating_report: "admin-operating-report-v1",
};

type GenerateAdminAiJsonParams<TValue extends Record<string, unknown>> = {
  ctx: AdminContext;
  feature: AdminAiFeature;
  operation?: AiOperation;
  promptVersion?: string;
  promptName?: string;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: unknown;
  fallbackValue: TValue;
  relatedProspectId?: string | null;
  relatedBusinessId?: string | null;
  inputSummary?: Record<string, unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
  throttlePerHour?: number;
  defaultConfidence?: number;
  defaultSources?: AdminAiSourceNote[];
  defaultWarnings?: string[];
  reviewStatus?: AdminAiReviewStatus;
  requiresHumanReview?: boolean;
  safeForPublicDisplay?: boolean;
  // Additive/protective, not gated by ADMIN_AI_V2_ENABLED: when true, skips
  // loadActivePromptOverride and always uses this call's own systemPrompt/
  // jsonSchema/promptVersion. Used by admin-ai-prompts' "test" action so
  // testing a CANDIDATE prompt/schema is never silently overridden by an
  // already-active DB prompt override for the same feature. Every existing
  // caller omits this (defaults to false) and is unaffected.
  skipPromptOverride?: boolean;
};

export type AdminAiGeneration<TValue extends Record<string, unknown>> = {
  output: TValue & AdminAiOutputBase;
  provider: string;
  model: string;
  promptVersion: string;
  requestGroupId: string;
  fallbackUsed: boolean;
  attempts: ProviderAttempt[];
};

const BANNED_PUBLIC_COPY_PATTERNS = [
  /\bBOGO\b/gi,
  /\b2\s*-\s*for\s*-\s*1\b/gi,
  /\b2\s+for\s+1\b/gi,
  /\b2x1\b/gi,
];

function safeNumber(value: unknown, fallback: number, min = 0, max = 1): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeReviewStatus(value: unknown, fallback: AdminAiReviewStatus): AdminAiReviewStatus {
  return value === "needs_review" ||
      value === "approved" ||
      value === "rejected" ||
      value === "superseded"
    ? value
    : fallback;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sanitizeText(value: string): { value: string; warnings: string[] } {
  let next = value;
  const warnings: string[] = [];
  for (const pattern of BANNED_PUBLIC_COPY_PATTERNS) {
    if (pattern.test(next)) {
      next = next.replace(pattern, "local offer");
      warnings.push("Banned public wording was replaced with safer Twofer language.");
    }
    pattern.lastIndex = 0;
  }
  return { value: next, warnings };
}

function sanitizeOutput(value: unknown): { value: unknown; warnings: string[] } {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) {
    const warnings: string[] = [];
    return {
      value: value.map((item) => {
        const sanitized = sanitizeOutput(item);
        warnings.push(...sanitized.warnings);
        return sanitized.value;
      }),
      warnings,
    };
  }
  if (value && typeof value === "object") {
    const warnings: string[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeOutput(nested);
      warnings.push(...sanitized.warnings);
      next[key] = sanitized.value;
    }
    return { value: next, warnings };
  }
  return { value, warnings: [] };
}

function bannedPhrasesPresent(text: string): boolean {
  let matched = false;
  for (const pattern of BANNED_PUBLIC_COPY_PATTERNS) {
    if (pattern.test(text)) matched = true;
    pattern.lastIndex = 0;
  }
  return matched;
}

const BANNED_PHRASE_REWRITE_SCHEMA = {
  name: "admin_ai_banned_phrase_rewrite",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { text: { type: "string" } },
    required: ["text"],
  },
};

// Bounds the number of banned-phrase rewrite provider calls a single
// generateAdminAiJson run can make, so a pathological output (many
// public-facing fields all tripping the sanitizer) can't balloon latency or
// cost. Fields beyond this cap fall back to the existing blind string
// replace, same as flag-off.
const MAX_BANNED_PHRASE_REWRITES = 3;

async function rewriteBannedPhraseText(params: {
  text: string;
  openAiApiKey?: string;
  geminiApiKey?: string;
  admin: unknown;
  requestGroupId: string;
}): Promise<string | null> {
  try {
    const result = await generateStructuredText({
      operation: "copy_revision",
      systemPrompt: [
        "Rewrite merchant-facing Twofer copy to remove specific banned terms without changing anything else about meaning, tone, facts, or length.",
        bannedPhraseGuardrailSection(),
        "Return only the rewritten text in the text field. Do not add commentary.",
      ].join("\n"),
      userPrompt: `Rewrite this text so it contains none of the banned terms, changing nothing else about it:\n\n${params.text}`,
      jsonSchema: BANNED_PHRASE_REWRITE_SCHEMA,
      maxOutputTokens: 220,
      timeoutMs: 8_000,
      generationRunId: params.requestGroupId,
      promptVersion: "admin-ai-banned-phrase-rewrite-v1",
      reasoningLevel: "low",
    }, {
      openAiApiKey: params.openAiApiKey,
      geminiApiKey: params.geminiApiKey,
      admin: params.admin as { from(table: string): any },
    });
    const value = result.value as { text?: unknown } | null | undefined;
    return typeof value?.text === "string" ? value.text : null;
  } catch {
    return null;
  }
}

/**
 * V2-only sanitize path. Structurally mirrors the sync sanitizeOutput above
 * (same recursive walk, same sanitizeText fallback for the blind replace),
 * but for a public-facing field (see isPublicFacingFieldName) whose text
 * trips a banned pattern, it first tries ONE cheap AI rewrite that removes
 * the term without otherwise changing the text. The blind string replace is
 * used only when: the field is internal-only, no provider key is
 * configured, the per-run rewrite budget is exhausted, or the rewrite
 * attempt failed / still contains a banned term.
 */
async function sanitizeOutputV2Async(
  value: unknown,
  fieldName: string | null,
  ctx: { openAiApiKey?: string; geminiApiKey?: string; admin: unknown; requestGroupId: string; rewriteBudget: { count: number } },
): Promise<{ value: unknown; warnings: string[] }> {
  if (typeof value === "string") {
    if (!bannedPhrasesPresent(value)) return { value, warnings: [] };
    const canReask = isPublicFacingFieldName(fieldName) &&
      (Boolean(ctx.openAiApiKey) || Boolean(ctx.geminiApiKey)) &&
      ctx.rewriteBudget.count < MAX_BANNED_PHRASE_REWRITES;
    if (canReask) {
      ctx.rewriteBudget.count += 1;
      const rewritten = await rewriteBannedPhraseText({
        text: value,
        openAiApiKey: ctx.openAiApiKey,
        geminiApiKey: ctx.geminiApiKey,
        admin: ctx.admin,
        requestGroupId: ctx.requestGroupId,
      });
      if (rewritten && !bannedPhrasesPresent(rewritten)) {
        return {
          value: rewritten,
          warnings: ["Banned public wording was rewritten by AI so the replacement reads naturally."],
        };
      }
    }
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    const warnings: string[] = [];
    const next: unknown[] = [];
    for (const item of value) {
      const sanitized = await sanitizeOutputV2Async(item, fieldName, ctx);
      warnings.push(...sanitized.warnings);
      next.push(sanitized.value);
    }
    return { value: next, warnings };
  }
  if (value && typeof value === "object") {
    const warnings: string[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = await sanitizeOutputV2Async(nested, key, ctx);
      warnings.push(...sanitized.warnings);
      next[key] = sanitized.value;
    }
    return { value: next, warnings };
  }
  return { value, warnings: [] };
}

function normalizeSources(value: unknown, defaults: AdminAiSourceNote[]): AdminAiSourceNote[] {
  const rows = Array.isArray(value) ? value : [];
  const normalized = rows
    .map((row): AdminAiSourceNote | null => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim().slice(0, 120) : "";
      if (!label) return null;
      return {
        label,
        url: typeof record.url === "string" ? record.url.trim().slice(0, 500) : null,
        notes: typeof record.notes === "string" ? record.notes.trim().slice(0, 500) : null,
      };
    })
    .filter((row): row is AdminAiSourceNote => Boolean(row));
  return [...normalized, ...defaults].slice(0, 12);
}

function summarizeAttempts(attempts: ProviderAttempt[]): Array<Record<string, unknown>> {
  return attempts.map((attempt) => ({
    provider: attempt.provider,
    model: attempt.model,
    operation: attempt.operation,
    success: attempt.success,
    latency_ms: attempt.latencyMs,
    error_class: attempt.errorClass ?? null,
    error_code: attempt.errorCode ?? null,
    input_tokens: attempt.inputTokens ?? 0,
    output_tokens: attempt.outputTokens ?? 0,
    estimated_cost_usd: attempt.estimatedCostUsd ?? 0,
  }));
}

function totalAttemptCost(attempts: ProviderAttempt[]): number {
  return Number(attempts.reduce((sum, attempt) => sum + (attempt.estimatedCostUsd ?? 0), 0).toFixed(6));
}

function totalAttemptTokens(attempts: ProviderAttempt[], key: "inputTokens" | "outputTokens"): number {
  return attempts.reduce((sum, attempt) => sum + (attempt[key] ?? 0), 0);
}

async function throttleAdminAi(params: {
  ctx: AdminContext;
  feature: AdminAiFeature;
  throttlePerHour: number;
}): Promise<void> {
  if (params.throttlePerHour <= 0) return;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await params.ctx.supabaseAdmin
    .from("ai_generation_logs")
    .select("id", { count: "exact", head: true })
    .eq("admin_user_id", params.ctx.user.id)
    .eq("request_type", `admin_${params.feature}`)
    .gte("created_at", since);
  if (error) {
    console.warn(JSON.stringify({
      tag: "admin_ai",
      event: "throttle_check_failed",
      feature: params.feature,
      errorCode: "ADMIN_AI_THROTTLE_CHECK_FAILED",
    }));
    return;
  }
  if ((count ?? 0) >= params.throttlePerHour) {
    throw new Error("ADMIN_AI_RATE_LIMITED");
  }
}

async function logProviderAttempts(params: {
  ctx: AdminContext;
  feature: AdminAiFeature;
  requestGroupId: string;
  relatedBusinessId?: string | null;
  attempts: ProviderAttempt[];
}) {
  if (!params.attempts.length) {
    await logAiCost(params.ctx.supabaseAdmin, {
      requestGroupId: params.requestGroupId,
      feature: `admin_${params.feature}`,
      provider: "deterministic",
      model: "admin-ai-deterministic-fallback",
      endpoint: `admin.${params.feature}`,
      estimatedCostUsd: 0,
      ownerUserId: params.ctx.user.id,
      businessId: params.relatedBusinessId ?? null,
      success: true,
    });
    return;
  }

  await Promise.all(params.attempts.map((attempt) =>
    logAiCost(params.ctx.supabaseAdmin, {
      requestGroupId: params.requestGroupId,
      feature: `admin_${params.feature}`,
      provider: attempt.provider,
      model: attempt.model,
      endpoint: `admin.${params.feature}.${attempt.operation}`,
      usage: {
        input_tokens: attempt.inputTokens ?? 0,
        output_tokens: attempt.outputTokens ?? 0,
      },
      estimatedCostUsd: attempt.estimatedCostUsd ?? 0,
      ownerUserId: params.ctx.user.id,
      businessId: params.relatedBusinessId ?? null,
      openaiRequestId: attempt.provider === "openai" ? attempt.requestId ?? null : null,
      success: attempt.success,
      errorCode: attempt.errorCode ?? null,
      errorMessage: attempt.errorClass ?? null,
    })
  ));
}

async function logAdminAiOutput<TValue extends Record<string, unknown>>(params: {
  ctx: AdminContext;
  feature: AdminAiFeature;
  requestGroupId: string;
  promptName: string;
  promptVersion: string;
  provider: string;
  model: string;
  inputSummary: Record<string, unknown>;
  output: TValue & AdminAiOutputBase;
  relatedProspectId?: string | null;
  relatedBusinessId?: string | null;
  attempts: ProviderAttempt[];
  fallbackUsed: boolean;
}) {
  const requestHash = await sha256Hex(stableStringify({
    feature: params.feature,
    prompt_version: params.promptVersion,
    input: params.inputSummary,
  }));
  const { error } = await params.ctx.supabaseAdmin.from("ai_generation_logs").insert({
    business_id: params.relatedBusinessId ?? null,
    user_id: params.ctx.user.id,
    admin_user_id: params.ctx.user.id,
    related_business_id: params.relatedBusinessId ?? null,
    related_prospect_id: params.relatedProspectId ?? null,
    request_type: `admin_${params.feature}`,
    input_mode: "admin_dashboard",
    prompt_text: `${params.promptName}:${params.promptVersion}`,
    request_hash: requestHash,
    prompt_version: params.promptVersion,
    provider: params.provider,
    model: params.model,
    success: true,
    response_payload: {
      output: params.output,
      attempts: summarizeAttempts(params.attempts),
      fallback_used: params.fallbackUsed,
      related_prospect_id: params.relatedProspectId ?? null,
      related_business_id: params.relatedBusinessId ?? null,
    },
    cost_basis_json: {
      attempts: summarizeAttempts(params.attempts),
      estimated_cost_usd: totalAttemptCost(params.attempts),
    },
    sources_json: params.output.sources,
    review_status: params.output.review_status,
    safe_for_public_display: params.output.safe_for_public_display,
    requires_human_review: params.output.requires_human_review,
    input_token_count: totalAttemptTokens(params.attempts, "inputTokens"),
    output_token_count: totalAttemptTokens(params.attempts, "outputTokens"),
    estimated_cost_usd: totalAttemptCost(params.attempts),
    openai_called: params.attempts.some((attempt) => attempt.provider === "openai" || attempt.provider === "gemini"),
  });
  if (error) throw error;
}

async function loadActivePromptOverride(params: {
  ctx: AdminContext;
  feature: AdminAiFeature;
  promptName: string;
  fallbackVersion: string;
  fallbackSystemPrompt: string;
  fallbackJsonSchema: unknown;
}): Promise<{
  promptVersion: string;
  systemPrompt: string;
  jsonSchema: unknown;
}> {
  const { data, error } = await params.ctx.supabaseAdmin
    .from("admin_ai_prompts")
    .select("id,prompt_version,system_prompt,output_schema")
    .eq("feature", params.feature)
    .eq("prompt_name", params.promptName)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(JSON.stringify({
      tag: "admin_ai",
      event: "prompt_registry_read_failed",
      feature: params.feature,
      errorCode: "ADMIN_AI_PROMPT_REGISTRY_READ_FAILED",
    }));
    return {
      promptVersion: params.fallbackVersion,
      systemPrompt: params.fallbackSystemPrompt,
      jsonSchema: params.fallbackJsonSchema,
    };
  }

  if (!data?.id) {
    return {
      promptVersion: params.fallbackVersion,
      systemPrompt: params.fallbackSystemPrompt,
      jsonSchema: params.fallbackJsonSchema,
    };
  }

  await params.ctx.supabaseAdmin
    .from("admin_ai_prompts")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  const schemaRecord = data.output_schema && typeof data.output_schema === "object" && !Array.isArray(data.output_schema)
    ? data.output_schema as Record<string, unknown>
    : {};

  return {
    promptVersion: typeof data.prompt_version === "string" && data.prompt_version.trim()
      ? data.prompt_version.trim()
      : params.fallbackVersion,
    systemPrompt: typeof data.system_prompt === "string" && data.system_prompt.trim()
      ? data.system_prompt
      : params.fallbackSystemPrompt,
    jsonSchema: Object.keys(schemaRecord).length ? schemaRecord : params.fallbackJsonSchema,
  };
}

function genericAdminAiSystemPrompt(feature: AdminAiFeature): string {
  return [
    "You help run Twofer operations from the internal website/admin dashboard only.",
    "Never write instructions for the mobile app and never ask the browser or Expo client to call an AI provider.",
    "Do not create, suggest creating, or imply a live deal for an unclaimed prospect.",
    "Do not imply an unclaimed business is a Twofer partner.",
    "Demand proof must stay aggregated and must not reveal customer names, emails, phone numbers, exact home locations, or individual behavior.",
    "Keep Stripe, billing, claim-token, and trial actions recommendation-only unless a separate audited admin function performs the action.",
    "Do not include raw claim tokens, API keys, secrets, provider error bodies, or private source payloads.",
    "Use merchant-safe wording such as Twofer deals, local offers, limited-time offers, paired offers, or bonus item offers.",
    `Feature: ${feature}. Return only strict JSON matching the schema.`,
  ].join("\n");
}

/**
 * Builds the system prompt handed to the AI provider for `feature`.
 *
 * Flag-off (ADMIN_AI_V2_ENABLED unset/false, the default): returns exactly
 * genericAdminAiSystemPrompt(feature), byte-identical to the prompt every
 * feature has always shared.
 *
 * Flag-on: appends a banned-public-copy-phrase guardrail (naming the exact
 * terms sanitizeText patches around, see BANNED_PUBLIC_COPY_PATTERNS below)
 * and, for the four features that have one, a feature-specific section
 * (tone/word-count/example/trial-facts for sales_script; decision criteria
 * for onboarding_review; grounding rules for prospect_enrichment; the scoring
 * rubric for prospect_scoring). Every other feature keeps the generic prompt
 * plus the banned-phrase guardrail only.
 */
export function adminAiSystemPrompt(feature: AdminAiFeature): string {
  const generic = genericAdminAiSystemPrompt(feature);
  if (!adminAiV2Enabled()) return generic;
  const sections = [generic, bannedPhraseGuardrailSection()];
  const featureSection = featureSystemPromptSection(feature);
  if (featureSection) sections.push(featureSection);
  return sections.join("\n\n");
}

export async function generateAdminAiJson<TValue extends Record<string, unknown>>(
  params: GenerateAdminAiJsonParams<TValue>,
): Promise<AdminAiGeneration<TValue>> {
  const requestGroupId = crypto.randomUUID();
  const fallbackPromptVersion = params.promptVersion ?? ADMIN_AI_PROMPT_VERSIONS[params.feature];
  const promptName = params.promptName ?? params.feature;
  const inputSummary = params.inputSummary ?? {};
  const defaultWarnings = [...(params.defaultWarnings ?? [])];
  const defaultSources = params.defaultSources ?? [];
  let provider = "deterministic";
  let model = "admin-ai-deterministic-fallback";
  let fallbackUsed = true;
  let attempts: ProviderAttempt[] = [];
  let rawValue: Record<string, unknown> = params.fallbackValue;

  await throttleAdminAi({
    ctx: params.ctx,
    feature: params.feature,
    throttlePerHour: params.throttlePerHour ?? 40,
  });

  // skipPromptOverride is additive/protective (see the field comment on
  // GenerateAdminAiJsonParams): it is not gated by ADMIN_AI_V2_ENABLED and
  // every existing caller omits it, so this branch never changes existing
  // behavior for them.
  const activePrompt = params.skipPromptOverride
    ? { promptVersion: fallbackPromptVersion, systemPrompt: params.systemPrompt, jsonSchema: params.jsonSchema }
    : await loadActivePromptOverride({
      ctx: params.ctx,
      feature: params.feature,
      promptName,
      fallbackVersion: fallbackPromptVersion,
      fallbackSystemPrompt: params.systemPrompt,
      fallbackJsonSchema: params.jsonSchema,
    });
  const promptVersion = activePrompt.promptVersion;
  const v2Enabled = adminAiV2Enabled();
  // Flag-off: identical to the old `params.maxOutputTokens ?? 1100`. Flag-on:
  // sales_script and trial_conversion_assistant default to 2400 instead of
  // 1100 (their outputs regularly need more room — a full script bundle or a
  // multi-part conversion plan); an explicit params.maxOutputTokens always
  // wins over both defaults, same as before.
  const maxOutputTokens = params.maxOutputTokens ??
    (v2Enabled ? ADMIN_AI_V2_MAX_OUTPUT_TOKENS[params.feature] : undefined) ??
    1100;

  const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (openAiApiKey || geminiApiKey) {
    try {
      const result = await generateStructuredText({
        operation: params.operation ?? "merchant_context",
        systemPrompt: activePrompt.systemPrompt,
        userPrompt: params.userPrompt,
        jsonSchema: activePrompt.jsonSchema,
        maxOutputTokens,
        timeoutMs: params.timeoutMs ?? 12_000,
        generationRunId: requestGroupId,
        promptVersion,
        reasoningLevel: "low",
      }, {
        openAiApiKey,
        geminiApiKey,
        admin: params.ctx.supabaseAdmin,
      });
      if (result.value && typeof result.value === "object" && !Array.isArray(result.value)) {
        rawValue = result.value as Record<string, unknown>;
        provider = result.provider;
        model = result.model;
        fallbackUsed = result.fallbackUsed;
        attempts = result.attempts;
      } else {
        defaultWarnings.push("AI provider returned an invalid object; deterministic fallback was used.");
        attempts = result.attempts;
      }
    } catch (error) {
      const maybeAttempts = (error as { attempts?: ProviderAttempt[] })?.attempts;
      attempts = Array.isArray(maybeAttempts) ? maybeAttempts : [];
      defaultWarnings.push("AI provider failed with a sanitized error; deterministic fallback was used.");
    }
  } else {
    defaultWarnings.push("No server-side AI provider key is configured; deterministic fallback was used.");
  }

  // V2 completeness re-ask: for the features in ADMIN_AI_V2_REQUIRED_STRING_FIELDS
  // (currently sales_script and trial_conversion_assistant), a successful
  // provider call that still left a required copy field blank gets exactly
  // one repair attempt asking the model to fill in the named fields. If the
  // repair still leaves a field blank, or itself fails, this falls back to
  // the deterministic fallbackValue exactly like a provider failure would.
  if (v2Enabled && !fallbackUsed) {
    const requiredStringFields = ADMIN_AI_V2_REQUIRED_STRING_FIELDS[params.feature];
    const missing = requiredStringFields?.length
      ? findEmptyRequiredStringFields(rawValue, requiredStringFields)
      : [];
    if (missing.length) {
      try {
        const repairResult = await generateStructuredText({
          operation: params.operation ?? "merchant_context",
          systemPrompt: activePrompt.systemPrompt,
          userPrompt: `${params.userPrompt}\n\nYour previous response left these required fields empty or missing: ${missing.join(", ")}. Return the full corrected JSON with every field completed; do not leave any required field blank.`,
          jsonSchema: activePrompt.jsonSchema,
          maxOutputTokens,
          timeoutMs: params.timeoutMs ?? 12_000,
          generationRunId: requestGroupId,
          promptVersion,
          reasoningLevel: "low",
        }, {
          openAiApiKey,
          geminiApiKey,
          admin: params.ctx.supabaseAdmin,
        });
        attempts = [...attempts, ...repairResult.attempts];
        const repairedValue = repairResult.value && typeof repairResult.value === "object" && !Array.isArray(repairResult.value)
          ? repairResult.value as Record<string, unknown>
          : null;
        const stillMissing = repairedValue
          ? findEmptyRequiredStringFields(repairedValue, requiredStringFields ?? [])
          : requiredStringFields ?? [];
        if (repairedValue && !stillMissing.length) {
          rawValue = repairedValue;
          provider = repairResult.provider;
          model = repairResult.model;
          fallbackUsed = repairResult.fallbackUsed;
        } else {
          rawValue = params.fallbackValue;
          fallbackUsed = true;
          provider = "deterministic";
          model = "admin-ai-deterministic-fallback";
          defaultWarnings.push("AI output was incomplete after one repair attempt; deterministic fallback was used.");
        }
      } catch (repairError) {
        const maybeAttempts = (repairError as { attempts?: ProviderAttempt[] })?.attempts;
        attempts = [...attempts, ...(Array.isArray(maybeAttempts) ? maybeAttempts : [])];
        rawValue = params.fallbackValue;
        fallbackUsed = true;
        provider = "deterministic";
        model = "admin-ai-deterministic-fallback";
        defaultWarnings.push("AI output was incomplete and the repair attempt failed; deterministic fallback was used.");
      }
    }
  }

  const sanitized = v2Enabled
    ? await sanitizeOutputV2Async(rawValue, null, {
      openAiApiKey,
      geminiApiKey,
      admin: params.ctx.supabaseAdmin,
      requestGroupId,
      rewriteBudget: { count: 0 },
    })
    : sanitizeOutput(rawValue);
  const outputRecord = sanitized.value && typeof sanitized.value === "object" && !Array.isArray(sanitized.value)
    ? sanitized.value as Record<string, unknown>
    : { ...params.fallbackValue };
  const warnings = Array.from(new Set([
    ...defaultWarnings,
    ...sanitized.warnings,
    ...(Array.isArray(outputRecord.warnings) ? outputRecord.warnings.map(String) : []),
  ])).slice(0, 20);
  const output = {
    ...outputRecord,
    confidence: safeNumber(outputRecord.confidence, params.defaultConfidence ?? 0.6),
    sources: normalizeSources(outputRecord.sources, defaultSources),
    warnings,
    review_status: safeReviewStatus(outputRecord.review_status, params.reviewStatus ?? "needs_review"),
    generated_at: new Date().toISOString(),
    model,
    provider,
    prompt_version: promptVersion,
    requires_human_review: params.requiresHumanReview === false
      ? outputRecord.requires_human_review === true
      : true,
    safe_for_public_display: params.safeForPublicDisplay === true &&
      outputRecord.safe_for_public_display !== false,
  } as TValue & AdminAiOutputBase;

  await logProviderAttempts({
    ctx: params.ctx,
    feature: params.feature,
    requestGroupId,
    relatedBusinessId: params.relatedBusinessId ?? null,
    attempts,
  });
  await logAdminAiOutput({
    ctx: params.ctx,
    feature: params.feature,
    requestGroupId,
    promptName,
    promptVersion,
    provider,
    model,
    inputSummary,
    output,
    relatedProspectId: params.relatedProspectId ?? null,
    relatedBusinessId: params.relatedBusinessId ?? null,
    attempts,
    fallbackUsed,
  });

  return {
    output,
    provider,
    model,
    promptVersion,
    requestGroupId,
    fallbackUsed,
    attempts,
  };
}
