export type AiImageDeadline = {
  startedAtMs: number;
  budgetMs: number;
  reserveMs: number;
  minAttemptMs: number;
  skippedLegs: string[];
};

export type AiImageDeadlineReport = {
  elapsed_ms: number;
  budget_ms: number;
  remaining_ms: number;
  reserve_ms: number;
  min_attempt_ms: number;
  skipped_legs: string[];
  stage_timings_ms?: Record<string, number>;
};

export function createAiImageDeadline(params: {
  startedAtMs?: number;
  budgetMs: number;
  reserveMs?: number;
  minAttemptMs?: number;
}): AiImageDeadline {
  return {
    startedAtMs: params.startedAtMs ?? Date.now(),
    budgetMs: Math.max(30_000, Math.floor(params.budgetMs)),
    reserveMs: Math.max(1_000, Math.floor(params.reserveMs ?? 12_000)),
    minAttemptMs: Math.max(1_000, Math.floor(params.minAttemptMs ?? 15_000)),
    skippedLegs: [],
  };
}

export function aiImageElapsedMs(deadline: AiImageDeadline, nowMs = Date.now()): number {
  return Math.max(0, nowMs - deadline.startedAtMs);
}

export function aiImageRemainingMs(deadline: AiImageDeadline, nowMs = Date.now()): number {
  return Math.max(0, deadline.budgetMs - aiImageElapsedMs(deadline, nowMs));
}

export function aiImageAvailableMs(deadline: AiImageDeadline, nowMs = Date.now()): number {
  return Math.max(0, aiImageRemainingMs(deadline, nowMs) - deadline.reserveMs);
}

export function markAiImageLegSkipped(deadline: AiImageDeadline | null | undefined, leg: string): void {
  if (!deadline || !leg) return;
  if (!deadline.skippedLegs.includes(leg)) deadline.skippedLegs.push(leg);
}

export function canSpendAiImageDeadline(
  deadline: AiImageDeadline | null | undefined,
  leg: string,
  estimateMs: number,
  nowMs = Date.now(),
): boolean {
  if (!deadline) return true;
  const allowed = aiImageAvailableMs(deadline, nowMs) >= Math.max(0, estimateMs);
  if (!allowed) markAiImageLegSkipped(deadline, leg);
  return allowed;
}

export function aiImageAttemptTimeoutMs(
  deadline: AiImageDeadline | null | undefined,
  leg: string,
  maxTimeoutMs: number,
  nowMs = Date.now(),
): { ok: true; timeoutMs: number } | { ok: false; errorCode: "DEADLINE_SKIPPED" } {
  if (!deadline) return { ok: true, timeoutMs: maxTimeoutMs };
  const availableMs = aiImageAvailableMs(deadline, nowMs);
  if (availableMs < deadline.minAttemptMs) {
    markAiImageLegSkipped(deadline, leg);
    return { ok: false, errorCode: "DEADLINE_SKIPPED" };
  }
  return { ok: true, timeoutMs: Math.max(1_000, Math.min(maxTimeoutMs, Math.floor(availableMs))) };
}

export function aiImageFetchErrorCode(
  error: unknown,
  deadline: AiImageDeadline | null | undefined,
): "TIMEOUT" | "DEADLINE_EXCEEDED" | "FETCH_ERROR" {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (deadline && aiImageAvailableMs(deadline) <= 0) return "DEADLINE_EXCEEDED";
  if (name === "TimeoutError" || name === "AbortError" || message.includes("timeout") || message.includes("abort")) {
    return "TIMEOUT";
  }
  return "FETCH_ERROR";
}

export function isAiImageTimeoutCode(code: string | null | undefined): boolean {
  return code === "TIMEOUT" || code === "DEADLINE_EXCEEDED" || code === "DEADLINE_SKIPPED";
}

export function shouldRetryAiImageAttempt(
  attempt: { errorCode: string | null; latencyMs?: number },
  deadline: AiImageDeadline | null | undefined,
  fastFailureMaxMs = 20_000,
): boolean {
  if (!attempt.errorCode || isAiImageTimeoutCode(attempt.errorCode)) return false;
  if (attempt.errorCode === "MISSING_GEMINI_API_KEY" || attempt.errorCode === "INVALID_INPUT_IMAGE") return false;
  if (!deadline) return true;
  return (attempt.latencyMs ?? fastFailureMaxMs + 1) <= fastFailureMaxMs &&
    aiImageAvailableMs(deadline) >= deadline.minAttemptMs;
}

export function aiImageDeadlineReport(
  deadline: AiImageDeadline,
  nowMs = Date.now(),
  stageTimingsMs?: Record<string, number>,
): AiImageDeadlineReport {
  const report: AiImageDeadlineReport = {
    elapsed_ms: aiImageElapsedMs(deadline, nowMs),
    budget_ms: deadline.budgetMs,
    remaining_ms: aiImageRemainingMs(deadline, nowMs),
    reserve_ms: deadline.reserveMs,
    min_attempt_ms: deadline.minAttemptMs,
    skipped_legs: [...deadline.skippedLegs],
  };
  if (stageTimingsMs) {
    report.stage_timings_ms = Object.fromEntries(
      Object.entries(stageTimingsMs)
        .filter(([, value]) => Number.isFinite(value) && value >= 0)
        .map(([key, value]) => [key, Math.round(value)]),
    );
  }
  return report;
}
