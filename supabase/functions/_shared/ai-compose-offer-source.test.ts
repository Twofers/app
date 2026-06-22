import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-compose-offer", "index.ts"),
  "utf8",
);

describe("ai-compose-offer legacy fallback source guard", () => {
  it("does not return generated-looking canned copy when OpenAI is unavailable", () => {
    expect(source).toMatch(/OPENAI_KEY_MISSING/);
    expect(source).toMatch(/status:\s*503/);
    expect(source).toMatch(/result_source:\s*"unavailable"/);
    expect(source).not.toMatch(/fallbackResult/);
    expect(source).not.toMatch(/Handcrafted \$\{matched2\.item\}, doubled/);
    expect(source).not.toMatch(/quality buy-one-get-one/);
    expect(source).not.toMatch(/AI_ALLOW_DEMO_GENERATION/);
  });

  it("does not return a canned voice transcript when Whisper is unavailable", () => {
    const transcribeOnlyIndex = source.indexOf("if (transcribeOnly)");
    const missingKeyIndex = source.indexOf("if (!openAiKey)", transcribeOnlyIndex);
    const cooldownIndex = source.indexOf("const transcribeCooldownMs", transcribeOnlyIndex);

    expect(transcribeOnlyIndex).toBeGreaterThan(-1);
    expect(missingKeyIndex).toBeGreaterThan(transcribeOnlyIndex);
    expect(cooldownIndex).toBeGreaterThan(missingKeyIndex);

    const missingKeyBlock = source.slice(missingKeyIndex, cooldownIndex);
    expect(missingKeyBlock).toMatch(/OPENAI_KEY_MISSING/);
    expect(missingKeyBlock).toMatch(/status:\s*503/);
    expect(missingKeyBlock).toMatch(/success:\s*false/);
    expect(missingKeyBlock).toMatch(/openai_called:\s*false/);
    expect(missingKeyBlock).not.toMatch(/ok:\s*true/);
    expect(source).not.toMatch(/oat milk latte special/);
    expect(source).not.toMatch(/freshly pulled/);
  });

  it("does not generate legacy poster images with baked-in offer text", () => {
    expect(source).toMatch(/poster_disabled_reason/);
    expect(source).toMatch(/native_text_rendering_required/);
    expect(source).not.toMatch(/buildPosterImagePrompt/);
    expect(source).not.toMatch(/tryGeneratePosterPngWithTelemetry/);
    expect(source).not.toMatch(/poster_image_generation/);
    expect(source).not.toMatch(/ai_poster_/);
  });
});
