import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-studio-generate-draft", "index.ts"),
  "utf8",
);
const imageProviderSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "ai-image-provider.ts"),
  "utf8",
);
const devScreenSource = readFileSync(
  join(process.cwd(), "app", "ai-deal-studio-dev.tsx"),
  "utf8",
);

describe("ai-studio-generate-draft source guard", () => {
  it("requests Gemini images in the same 4:5 ratio used by the native preview", () => {
    expect(imageProviderSource).toMatch(/AiImageAspectRatio = "1:1" \| "4:3" \| "16:9" \| "4:5"/);
    expect(source).toMatch(/aspectRatio:\s*"4:5"/);
  });

  it("keeps image generation copy-only by default but deadline-aware when enabled", () => {
    expect(source).toMatch(/copyOnly:\s*bool\(body\.copy_only,\s*true\)/);
    expect(source).toMatch(/AI_STUDIO_ENABLE_IMAGE_GENERATION/);
    expect(source).toMatch(/createAiImageDeadline/);
    expect(source).toMatch(/AI_STUDIO_IMAGE_REQUEST_DEADLINE_MS/);
    expect(source).toMatch(/firstAttemptLeg:\s*"ai_studio_gemini_image"/);
    expect(source).toMatch(/retryAttemptLeg:\s*"ai_studio_gemini_image_retry"/);
    expect(source).toMatch(/image_deadline:\s*imageResult\.deadlineReport/);
    expect(source).toMatch(/stage_timings_ms:\s*stageTimingsMs/);
  });

  it("keeps the dev draft poster-first and source/rendered asset contract explicit", () => {
    expect(source).toMatch(/kicker:\s*\{\s*type:\s*"string"\s*\}/);
    expect(source).toMatch(/offer_line_1:\s*\{\s*type:\s*"string"\s*\}/);
    expect(source).toMatch(/composition_plan/);
    expect(source).toMatch(/source_asset_path:\s*draft\.image_asset_path/);
    expect(source).toMatch(/rendered_asset_path:\s*null/);
    expect(source).toMatch(/DEFAULT_CTA = ""/);
    expect(source).toMatch(/Never use the word Twofer in any poster field/);
    expect(source).toMatch(/scarcityLabel:\s*""/);
  });

  it("keeps deterministic poster fallback copy offer-aware instead of Try our item echoes", () => {
    expect(source).toContain("posterHeadlineFromOffer");
    expect(source).toContain("posterRewardLabel");
    expect(source).toContain("getFreeMatch");
    expect(source).toContain("isWeakPosterHeadline");
    expect(source).toContain("stripAwkwardAnyDeterminer");
    expect(source).toContain('kicker: "LOCAL DEAL"');
    expect(source).toContain("Never use 'Try our' as the kicker or headline");
    expect(source).toContain("not BUY AN ANY LARGE COFFEE DRINK");
    expect(source).not.toContain('kicker: "TRY OUR"');
    expect(source).not.toContain("`${product} TIME`");

    expect(devScreenSource).toContain("posterHeadlineFromOffer");
    expect(devScreenSource).toContain("getFreeMatch");
    expect(devScreenSource).toContain("safePosterHeadline");
    expect(devScreenSource).toContain("stripAwkwardAnyDeterminer");
    expect(devScreenSource).not.toContain("`${product} TIME`");
  });
});
