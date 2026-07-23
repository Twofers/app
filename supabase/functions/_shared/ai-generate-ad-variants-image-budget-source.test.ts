import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// R4 regression guard. A 40%-off "Haircut and fade" reproducibly killed the edge
// worker with WORKER_RESOURCE_LIMIT at ~150s: the provider chain can queue the
// primary Gemini call and its retry, then the category-safe call and ITS retry,
// then a gpt-image-1 fallback, then stock-fallback vision QA. That is a hard
// dead end for the merchant — no image, no deterministic fallback, 2.5 minutes gone.
//
// These are source assertions rather than behavioural tests because the budget is
// inline in produceImage, which needs live provider clients to exercise. They exist
// so the guards cannot be quietly deleted.
const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("image pipeline wall-clock budget (R4)", () => {
  it("defines a request-wide deadline that starts at function entry", () => {
    expect(source).toMatch(/createAiImageDeadline/);
    expect(source).toMatch(/startedAtMs:\s*requestStartedAtMs/);
    expect(source).toMatch(/AI_IMAGE_REQUEST_DEADLINE_MS/);
    // The old env name stays as a compatibility fallback, but the budget no
    // longer starts inside produceImage after research/copy have already run.
    expect(source).toMatch(/AI_IMAGE_PIPELINE_BUDGET_MS/);
    expect(source).not.toMatch(/const pipelineStartedAt = Date\.now\(\)/);
  });

  it("guards every escalating leg that runs after a failure", () => {
    for (const leg of [
      "gemini_category_safe",
      "openai_residual_fallback",
      "stock_fallback_qa",
    ]) {
      expect(source).toContain(`pipelineHasBudgetFor("${leg}"`);
    }
  });

  it("threads the same deadline into provider calls and image retries", () => {
    for (const leg of [
      "gemini_primary",
      "gemini_primary_retry",
      "gemini_category_safe_retry",
      "gemini_required_item_retry",
      "openai_primary",
      "openai_required_item_retry",
    ]) {
      expect(source).toContain(leg);
    }
    expect(source).toMatch(/imageDeadline,\s*stageTimingsMs/);
  });

  it("keeps the category-safe retry behind the budget check", () => {
    expect(source).toMatch(/if \(!imageBytes && pipelineHasBudgetFor\("gemini_category_safe"/);
  });

  it("keeps the OpenAI residual fallback behind the budget check", () => {
    expect(source).toMatch(/if \(useOpenAiFallback && pipelineHasBudgetFor\("openai_residual_fallback"/);
  });

  it("lets produceFallbackImage skip stock QA when the budget is spent", () => {
    expect(source).toMatch(/allowStockFallback\?:\s*boolean/);
    expect(source).toMatch(/stockFallbackEnabled && params\.allowStockFallback !== false/);
  });

  it("reports the budget through a caller-owned sink, not module state", () => {
    // A Deno isolate can serve concurrent requests, so per-request state must not
    // live at module scope.
    expect(source).toMatch(/budgetSink\?:\s*\{\s*report\?: AiImageDeadlineReport/);
    expect(source).toMatch(/params\.budgetSink\.report = aiImageDeadlineReport/);
    expect(source).not.toMatch(/^let imagePipelineBudgetReport/m);
  });

  it("surfaces the budget and stage report in the response body", () => {
    // Edge logs are not readable via the CLI, so a smoke has to read this from the
    // response to prove which legs were skipped.
    expect(source).toMatch(/image_pipeline_budget: imagePipelineBudget\.report \?\? null/);
    expect(source).toMatch(/stage_timings_ms: stageTimingsMs/);
  });
});
