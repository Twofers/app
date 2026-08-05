// Pure output-shape validation for ai-compose-offer, gated behind
// AI_COMPOSE_V2_GATES_ENABLED. Kept dependency-free (besides the shared strong-deal
// guard) so it can be unit-tested from vitest without any Deno/edge runtime.

import { findWeakDealSignal } from "../_shared/strong-deal-guard.ts";

/** Matches the limits stated in the compose system prompt (index.ts systemPrompt). */
export const COMPOSE_HEADLINE_MAX_CHARS = 42;
export const COMPOSE_SUBHEADLINE_MAX_CHARS = 80;
export const COMPOSE_CTA_MAX_CHARS = 24;

const HEADLINE_KEYS = ["headline_en", "headline_es", "headline_ko"] as const;
const SUBHEADLINE_KEYS = ["subheadline_en", "subheadline_es", "subheadline_ko"] as const;
const CTA_KEYS = ["cta_en", "cta_es", "cta_ko"] as const;
/** All merchant/customer-facing text fields on a variant, scanned for banned terms. */
const VARIANT_TEXT_KEYS = [...HEADLINE_KEYS, ...SUBHEADLINE_KEYS, ...CTA_KEYS, "style_label"] as const;

const FORBIDDEN_TERM_PATTERNS: { code: string; pattern: RegExp }[] = [
  { code: "FORBIDDEN_TERM_BOGO", pattern: /bogo/i },
  { code: "FORBIDDEN_TERM_SAME_ITEM", pattern: /same-item/i },
];

export type ComposeValidationViolation = {
  code: string;
  message: string;
};

export type ComposeValidationResult =
  | { ok: true }
  | { ok: false; violations: ComposeValidationViolation[] };

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function variantLabel(variant: Record<string, unknown>, index: number): string {
  const id = stringField(variant, "variant_id");
  return id || `#${index + 1}`;
}

function scanForbiddenAndPunctuation(
  text: string,
  fieldLabel: string,
  violations: ComposeValidationViolation[],
): void {
  if (!text) return;
  for (const { code, pattern } of FORBIDDEN_TERM_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({ code, message: `${fieldLabel} contains a banned term ("${text}")` });
    }
  }
  if (text.includes("!")) {
    violations.push({ code: "EXCLAMATION_MARK", message: `${fieldLabel} contains an exclamation mark ("${text}")` });
  }
}

/**
 * Validates a parsed compose_offer AI output against the rules stated in the
 * system prompt (offer_type allow-list, per-field length limits, banned terms,
 * and the strong-deal-only policy). Pure: no I/O, no env access.
 */
export function validateComposeOutput(params: {
  offerTypes: readonly string[];
  offer: Record<string, unknown> | null | undefined;
  variants: unknown;
}): ComposeValidationResult {
  const violations: ComposeValidationViolation[] = [];
  const offer = params.offer ?? {};

  const offerType = stringField(offer, "offer_type");
  if (!offerType || !params.offerTypes.includes(offerType)) {
    violations.push({
      code: "OFFER_TYPE_INVALID",
      message: `recommended_offer.offer_type must be one of: ${params.offerTypes.join(", ")} (got "${offerType || "(empty)"}")`,
    });
  }

  const displayOffer = stringField(offer, "display_offer");
  scanForbiddenAndPunctuation(displayOffer, "recommended_offer.display_offer", violations);

  const variants: Record<string, unknown>[] = Array.isArray(params.variants)
    ? (params.variants.filter((v) => v && typeof v === "object") as Record<string, unknown>[])
    : [];

  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i];
    const label = variantLabel(variant, i);

    for (const key of HEADLINE_KEYS) {
      const value = stringField(variant, key);
      if (value.length > COMPOSE_HEADLINE_MAX_CHARS) {
        violations.push({
          code: "HEADLINE_OVER_LIMIT",
          message: `variant ${label} ${key} is ${value.length} chars, must be <= ${COMPOSE_HEADLINE_MAX_CHARS}`,
        });
      }
    }
    for (const key of SUBHEADLINE_KEYS) {
      const value = stringField(variant, key);
      if (value.length > COMPOSE_SUBHEADLINE_MAX_CHARS) {
        violations.push({
          code: "SUBHEADLINE_OVER_LIMIT",
          message: `variant ${label} ${key} is ${value.length} chars, must be <= ${COMPOSE_SUBHEADLINE_MAX_CHARS}`,
        });
      }
    }
    for (const key of CTA_KEYS) {
      const value = stringField(variant, key);
      if (value.length > COMPOSE_CTA_MAX_CHARS) {
        violations.push({
          code: "CTA_OVER_LIMIT",
          message: `variant ${label} ${key} is ${value.length} chars, must be <= ${COMPOSE_CTA_MAX_CHARS}`,
        });
      }
    }
    for (const key of VARIANT_TEXT_KEYS) {
      scanForbiddenAndPunctuation(stringField(variant, key), `variant ${label} ${key}`, violations);
    }
  }

  // Weak-deal policy: run over display_offer + each variant's English headline,
  // since that is the pair a shopper actually reads together. Deliberately uses
  // findWeakDealSignal (positive-signal only) rather than validateStrongDealOnly,
  // which also rejects text that simply lacks strong-language vocabulary — that
  // would false-positive on a legitimate free-item offer like "Free pastry with
  // any coffee" and burn the repair re-ask on a non-issue.
  for (let i = 0; i < variants.length; i += 1) {
    const variant = variants[i];
    const headlineEn = stringField(variant, "headline_en");
    if (!displayOffer && !headlineEn) continue;
    const weakSignal = findWeakDealSignal(`${displayOffer}\n${headlineEn}`);
    if (weakSignal) {
      violations.push({
        code: "WEAK_DEAL",
        message: `variant ${variantLabel(variant, i)}: display_offer + headline_en ${weakSignal}`,
      });
    }
  }

  return violations.length > 0 ? { ok: false, violations } : { ok: true };
}

/**
 * Builds the single cheap repair instruction appended to a re-ask prompt.
 * Deliberately terse: the model already produced everything else correctly.
 */
export function formatRepairInstruction(violations: ComposeValidationViolation[]): string {
  const list = violations.map((v) => `- ${v.message}`).join("\n");
  return `Fix only these issues, keep everything else identical:\n${list}`;
}
