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
  it("defines a budget with a floor and an env override", () => {
    expect(source).toMatch(/AI_IMAGE_PIPELINE_BUDGET_MS/);
    // Floor keeps a misconfigured env from disabling the chain entirely; the
    // default must stay under the observed ~150s worker kill.
    expect(source).toMatch(/Math\.max\(30_000,\s*envNumber\("AI_IMAGE_PIPELINE_BUDGET_MS",\s*105_000\)\)/);
  });

  it("guards every escalating leg that runs after a failure", () => {
    for (const leg of ["gemini_category_safe", "openai_residual_fallback", "stock_fallback_qa"]) {
      expect(source).toContain(`pipelineHasBudgetFor("${leg}"`);
    }
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
    expect(source).toMatch(/budgetSink\?:\s*\{\s*report\?:/);
    expect(source).toMatch(/params\.budgetSink\.report =/);
    expect(source).not.toMatch(/^let imagePipelineBudgetReport/m);
  });

  it("surfaces the budget report in the response body", () => {
    // Edge logs are not readable via the CLI, so a smoke has to read this from the
    // response to prove which legs were skipped.
    expect(source).toMatch(/image_pipeline_budget: imagePipelineBudget\.report \?\? null/);
  });
});
