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

  it("does not keep deterministic craft-biased translation phrase fallbacks", () => {
    expect(source).toMatch(/function fallbackResult/);
    expect(source).toMatch(/title_en:\s*sourceLocale === "en" \? title : ""/);
    expect(source).toMatch(/title_es:\s*sourceLocale === "es" \? title : ""/);
    expect(source).toMatch(/title_ko:\s*sourceLocale === "ko" \? title : ""/);
    expect(source).not.toMatch(/TITLE_TRANS/);
    expect(source).not.toMatch(/DESC_TRANS/);
    expect(source).not.toMatch(/translateEnglishField/);
    expect(source).not.toMatch(/calidad artesanal/);
    expect(source).not.toMatch(/ingredientes de primera/);
    expect(source).not.toMatch(/single-origin/);
    expect(source).not.toMatch(/made fresh/);
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

  it("does not log raw config or outer handler exception text", () => {
    const configErrorIndex = source.indexOf('event: "text_provider_config_error"');
    const outerErrorIndex = source.indexOf('event: "error"');
    expect(configErrorIndex).toBeGreaterThan(-1);
    expect(outerErrorIndex).toBeGreaterThan(-1);

    const configErrorBlock = source.slice(configErrorIndex - 220, configErrorIndex + 260);
    const outerErrorBlock = source.slice(outerErrorIndex - 220, outerErrorIndex + 220);
    expect(configErrorBlock).toMatch(/errorCode:\s*"AI_TEXT_CONFIG_INVALID"/);
    expect(outerErrorBlock).toMatch(/errorCode:\s*"SERVER_ERROR"/);
    expect(configErrorBlock).not.toMatch(/String\(err\)/);
    expect(outerErrorBlock).not.toMatch(/err:\s*String\(err\)/);
  });
});
