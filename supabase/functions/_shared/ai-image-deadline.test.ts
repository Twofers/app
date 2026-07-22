import { describe, expect, it } from "vitest";

import {
  aiImageAttemptTimeoutMs,
  aiImageAvailableMs,
  aiImageDeadlineReport,
  aiImageFetchErrorCode,
  canSpendAiImageDeadline,
  createAiImageDeadline,
  isAiImageTimeoutCode,
  shouldRetryAiImageAttempt,
} from "./ai-image-deadline.ts";

describe("ai image request deadline", () => {
  it("tracks available time after the worker reserve", () => {
    const deadline = createAiImageDeadline({
      startedAtMs: 1_000,
      budgetMs: 120_000,
      reserveMs: 10_000,
      minAttemptMs: 15_000,
    });

    expect(aiImageAvailableMs(deadline, 21_000)).toBe(90_000);
    expect(canSpendAiImageDeadline(deadline, "gemini_category_safe", 60_000, 21_000)).toBe(true);
    expect(deadline.skippedLegs).toEqual([]);
  });

  it("records skipped legs when an estimate no longer fits", () => {
    const deadline = createAiImageDeadline({
      startedAtMs: 0,
      budgetMs: 90_000,
      reserveMs: 12_000,
      minAttemptMs: 15_000,
    });

    expect(canSpendAiImageDeadline(deadline, "openai_residual_fallback", 45_000, 50_000)).toBe(false);
    expect(deadline.skippedLegs).toEqual(["openai_residual_fallback"]);
  });

  it("caps provider timeouts to remaining request budget", () => {
    const deadline = createAiImageDeadline({
      startedAtMs: 0,
      budgetMs: 100_000,
      reserveMs: 10_000,
      minAttemptMs: 15_000,
    });

    expect(aiImageAttemptTimeoutMs(deadline, "gemini_primary", 60_000, 50_000)).toEqual({
      ok: true,
      timeoutMs: 40_000,
    });
    expect(aiImageAttemptTimeoutMs(deadline, "gemini_retry", 60_000, 82_000)).toEqual({
      ok: false,
      errorCode: "DEADLINE_SKIPPED",
    });
    expect(deadline.skippedLegs).toEqual(["gemini_retry"]);
  });

  it("does not retry timeout-like or slow provider failures under a deadline", () => {
    const deadline = createAiImageDeadline({ startedAtMs: Date.now(), budgetMs: 120_000 });

    expect(isAiImageTimeoutCode("TIMEOUT")).toBe(true);
    expect(shouldRetryAiImageAttempt({ errorCode: "TIMEOUT", latencyMs: 60_000 }, deadline)).toBe(false);
    expect(shouldRetryAiImageAttempt({ errorCode: "NO_IMAGE_DATA", latencyMs: 21_000 }, deadline)).toBe(false);
    expect(shouldRetryAiImageAttempt({ errorCode: "HTTP_429", latencyMs: 700 }, deadline)).toBe(true);
  });

  it("keeps deadline reports sanitized", () => {
    const deadline = createAiImageDeadline({
      startedAtMs: 10_000,
      budgetMs: 120_000,
      reserveMs: 10_000,
      minAttemptMs: 15_000,
    });
    deadline.skippedLegs.push("stock_fallback_qa");

    expect(aiImageDeadlineReport(deadline, 40_000, { research: 1234.5, bad: Number.NaN })).toEqual({
      elapsed_ms: 30_000,
      budget_ms: 120_000,
      remaining_ms: 90_000,
      reserve_ms: 10_000,
      min_attempt_ms: 15_000,
      skipped_legs: ["stock_fallback_qa"],
      stage_timings_ms: { research: 1235 },
    });
  });

  it("classifies aborts without exposing raw error text", () => {
    const deadline = createAiImageDeadline({ startedAtMs: Date.now(), budgetMs: 120_000 });

    expect(aiImageFetchErrorCode(new DOMException("The operation timed out.", "TimeoutError"), deadline)).toBe(
      "TIMEOUT",
    );
    expect(aiImageFetchErrorCode(new Error("socket closed with private upstream body"), deadline)).toBe("FETCH_ERROR");
  });
});
