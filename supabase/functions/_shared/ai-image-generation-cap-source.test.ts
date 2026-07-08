import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Part B (AI_IMAGE_GENERATIONS cap) source guard. The paid QA-triggered image
// regeneration on BOTH provider paths must stay behind the cap so setting
// AI_IMAGE_MAX_GENERATIONS_PER_REQUEST=1 in prod never buys a second image on a
// missing-item QA verdict, while the default (2) preserves today's behavior.
const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("Part B — image generation cap", () => {
  it("reads AI_IMAGE_MAX_GENERATIONS_PER_REQUEST with a default of 2", () => {
    expect(source).toContain('Deno.env.get("AI_IMAGE_MAX_GENERATIONS_PER_REQUEST")');
    expect(source).toContain("const MAX_IMAGE_GENERATIONS_PER_REQUEST");
    // Default preserves current behavior (one regeneration allowed).
    expect(source).toContain('"2"');
  });

  it("gates both QA-triggered image regenerations behind the cap", () => {
    const gateCount = source.split("MAX_IMAGE_GENERATIONS_PER_REQUEST >= 2").length - 1;
    // One gate on the OpenAI retry path, one on the Gemini retry path.
    expect(gateCount).toBeGreaterThanOrEqual(2);
    // QA telemetry (single pass) is preserved on both paths.
    expect(source).toContain('"image_generation_retry"');
  });
});
