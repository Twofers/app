export type GenerationOutcomeKind =
  | "ownership_blocked"
  | "quota_or_cooldown_blocked"
  | "input_or_offer_blocked"
  | "ai_failed_fallback_available"
  | "ai_failed_no_fallback";

type ClassifyGenerationFailureParams = {
  raw: string;
  code?: string;
  hasFallbackSource: boolean;
};

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function classifyGenerationFailure({
  raw,
  code,
  hasFallbackSource,
}: ClassifyGenerationFailureParams): GenerationOutcomeKind {
  const upperCode = (code ?? "").trim().toUpperCase();
  const lower = normalized(raw);

  if (
    lower.includes("do not own") ||
    lower.includes("don't own") ||
    lower.includes("don\u2019t own") ||
    lower.includes("owner account") ||
    lower.includes("not found for owner")
  ) {
    return "ownership_blocked";
  }

  if (upperCode === "MONTHLY_LIMIT" || upperCode === "COOLDOWN_ACTIVE" || upperCode === "REVISION_LIMIT") {
    return "quota_or_cooldown_blocked";
  }

  if (
    upperCode === "DEAL_NOT_ELIGIBLE_FOR_AI" ||
    upperCode === "DEAL_NOT_ELIGIBLE" ||
    upperCode === "INVALID_OFFER_DEFINITION" ||
    upperCode === "OPENAI_KEY_MISSING" ||
    lower.includes("photo") ||
    lower.includes("unauthorized") ||
    lower.includes("log in") ||
    lower.includes("invalid offer") ||
    lower.includes("not eligible")
  ) {
    return "input_or_offer_blocked";
  }

  return hasFallbackSource ? "ai_failed_fallback_available" : "ai_failed_no_fallback";
}

export function canUseFallbackTemplateForOutcome(kind: GenerationOutcomeKind | null): boolean {
  return kind === "ai_failed_fallback_available";
}
