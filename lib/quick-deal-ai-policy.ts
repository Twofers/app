const NON_FALLBACK_ERROR_CODES = new Set([
  "COOLDOWN_ACTIVE",
  "DEAL_NOT_ELIGIBLE_FOR_AI",
  "MONTHLY_LIMIT",
  "OPENAI_KEY_MISSING",
  "REVISION_LIMIT",
  "IMAGE_REQUIRED",
]);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function shouldUseQuickDealOfferDefinitionFallback(
  err: unknown,
  code?: string,
  hasSourceImage = false,
): boolean {
  if (!hasSourceImage) return false;
  if (code === "COPY_FAILED") return true;
  if (code && NON_FALLBACK_ERROR_CODES.has(code)) return false;

  const lower = errorMessage(err).toLowerCase();
  if (
    lower.includes("monthly limit") ||
    lower.includes("please wait") ||
    lower.includes("not eligible") ||
    lower.includes("do not own") ||
    lower.includes("don't own") ||
    lower.includes("unauthorized") ||
    lower.includes("log in") ||
    lower.includes("photo") ||
    lower.includes("storage") ||
    lower.includes("upload") ||
    lower.includes("not configured")
  ) {
    return false;
  }

  if (lower.includes("copy generation failed") || lower.includes("ai copy generation failed")) return true;
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("abort")) return true;
  return false;
}
