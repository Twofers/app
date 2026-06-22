import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-deal-suggestions", "index.ts"),
  "utf8",
);

describe("ai-deal-suggestions source guards", () => {
  it("does not return canned insight suggestions when provider configuration is unavailable", () => {
    expect(source).toMatch(/OPENAI_NOT_CONFIGURED/);
    expect(source).toMatch(/status:\s*503/);
    expect(source).toMatch(/routerCanUseGemini/);
    expect(source).not.toMatch(/fallbackSuggestions/);
    expect(source).not.toMatch(/Expand your lineup/);
    expect(source).not.toMatch(/Weekend pastry pairing/);
    expect(source).not.toMatch(/Tell your origin story/);

    const keyMissingIndex = source.indexOf("if (!openAiKey && !routerCanUseGemini)");
    const generationIndex = source.indexOf("generation = await generateStructuredText");
    expect(keyMissingIndex).toBeGreaterThan(-1);
    expect(generationIndex).toBeGreaterThan(keyMissingIndex);
  });

  it("routes insight generation through the shared provider router", () => {
    expect(source).toMatch(/generateStructuredText/);
    expect(source).toMatch(/resolveAiTextProviderConfig/);
    expect(source).toMatch(/logDealSuggestionProviderAttempts/);
    expect(source).not.toMatch(/fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/);
    expect(source).not.toMatch(/resolveOpenAiChatModel/);
  });

  it("does not return raw provider error details to the client", () => {
    expect(source).not.toMatch(/const text = await aiRes\.text\(\)/);
    expect(source).not.toMatch(/details:\s*text/);
    expect(source).not.toMatch(/errorMessage:\s*text\.slice/);

    const providerFailureIndex = source.indexOf("AI_GENERATION_FAILED");
    expect(providerFailureIndex).toBeGreaterThan(-1);
    const providerFailureBlock = source.slice(providerFailureIndex - 1200, providerFailureIndex + 600);
    expect(providerFailureBlock).toMatch(/const attempts = \(err as \{ attempts\?: ProviderAttempt\[\] \}\)\?\.attempts \?\? \[\]/);
    expect(providerFailureBlock).toMatch(/logDealSuggestionProviderAttempts/);
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
