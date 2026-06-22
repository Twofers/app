import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-translate-deal", "index.ts"),
  "utf8",
);

describe("ai-translate-deal source guards", () => {
  it("does not return deterministic translations when provider configuration is unavailable", () => {
    const missingKeyIndex = source.indexOf("if (!openAiKey && !routerCanUseGemini)");
    const generationIndex = source.indexOf("generation = await generateStructuredText");

    expect(missingKeyIndex).toBeGreaterThan(-1);
    expect(generationIndex).toBeGreaterThan(missingKeyIndex);

    const missingKeyBlock = source.slice(missingKeyIndex, generationIndex);
    expect(missingKeyBlock).toMatch(/OPENAI_NOT_CONFIGURED/);
    expect(missingKeyBlock).toMatch(/success:\s*false/);
    expect(missingKeyBlock).toMatch(/openaiCalled:\s*false/);
    expect(missingKeyBlock).toMatch(/503,\s*corsHeaders/);
    expect(missingKeyBlock).not.toMatch(/fallbackResult/);
    expect(missingKeyBlock).not.toMatch(/admin\.from\("deals"\)\.update/);
    expect(missingKeyBlock).not.toMatch(/ok:\s*true/);
  });

  it("routes translation through the shared provider router", () => {
    expect(source).toMatch(/generateStructuredText/);
    expect(source).toMatch(/resolveAiTextProviderConfig/);
    expect(source).toMatch(/logTranslationProviderAttempts/);
    expect(source).toMatch(/operation:\s*"translation"/);
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
    expect(providerFailureBlock).toMatch(/logTranslationProviderAttempts/);
    expect(providerFailureBlock).toMatch(/502,\s*corsHeaders/);
    expect(providerFailureBlock).toMatch(/error_code:\s*"AI_GENERATION_FAILED"/);
  });
});
