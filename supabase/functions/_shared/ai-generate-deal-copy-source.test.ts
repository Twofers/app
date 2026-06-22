import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-deal-copy", "index.ts"),
  "utf8",
);

describe("ai-generate-deal-copy source guards", () => {
  it("routes deal-copy generation through the shared provider router", () => {
    expect(source).toMatch(/generateStructuredText/);
    expect(source).toMatch(/resolveAiTextProviderConfig/);
    expect(source).toMatch(/logDealCopyProviderAttempts/);
    expect(source).toMatch(/routerCanUseGemini/);
    expect(source).toMatch(/OPENAI_NOT_CONFIGURED/);
    expect(source).not.toMatch(/fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/);
  });

  it("does not bias deal-copy prompts with unsupported specialty-food claims", () => {
    expect(source).toMatch(/clear promotional copy for independent local businesses/);
    expect(source).toMatch(/Do not invent freshness, quality, ingredient, craft, health, popularity, discount, schedule, or availability claims/);
    expect(source).not.toMatch(/specialty coffee/);
    expect(source).not.toMatch(/hand-pulled/);
    expect(source).not.toMatch(/stone-ground/);
    expect(source).not.toMatch(/freshly baked/);
    expect(source).not.toMatch(/small-batch/);
    expect(source).not.toMatch(/real ingredients, real care/);
  });

  it("does not return raw provider error details to the client", () => {
    expect(source).not.toMatch(/const text = await aiRes\.text\(\)/);
    expect(source).not.toMatch(/details:\s*text/);
    expect(source).not.toMatch(/errorMessage:\s*text\.slice/);

    const providerFailureIndex = source.indexOf("AI_GENERATION_FAILED");
    expect(providerFailureIndex).toBeGreaterThan(-1);
    const providerFailureBlock = source.slice(providerFailureIndex - 1200, providerFailureIndex + 600);
    expect(providerFailureBlock).toMatch(/const attempts = \(err as \{ attempts\?: ProviderAttempt\[\] \}\)\?\.attempts \?\? \[\]/);
    expect(providerFailureBlock).toMatch(/logDealCopyProviderAttempts/);
    expect(providerFailureBlock).toMatch(/status:\s*502/);
    expect(providerFailureBlock).toMatch(/error_code:\s*"AI_GENERATION_FAILED"/);
  });

  it("does not log raw text-provider config exception text", () => {
    const configErrorIndex = source.indexOf('event: "text_provider_config_error"');
    expect(configErrorIndex).toBeGreaterThan(-1);

    const configErrorBlock = source.slice(configErrorIndex - 220, configErrorIndex + 260);
    expect(configErrorBlock).toMatch(/errorCode:\s*"AI_TEXT_CONFIG_INVALID"/);
    expect(configErrorBlock).not.toMatch(/String\(err\)/);
    expect(configErrorBlock).not.toMatch(/err:\s*String/);
  });
});
