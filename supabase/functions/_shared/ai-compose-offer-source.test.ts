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

  it("does not return raw Whisper provider errors to voice callers", () => {
    const whisperErrorIndex = source.indexOf('event: "whisper_error"');
    const responseIndex = source.indexOf("return new Response(", whisperErrorIndex);
    const blockEnd = source.indexOf("    let promptText", responseIndex);
    const whisperProviderFailureIndex = source.indexOf("if (!res.ok)");
    const whisperProviderSuccessIndex = source.indexOf("const j = await res.json()", whisperProviderFailureIndex);

    expect(whisperErrorIndex).toBeGreaterThan(-1);
    expect(responseIndex).toBeGreaterThan(whisperErrorIndex);
    expect(blockEnd).toBeGreaterThan(responseIndex);
    expect(whisperProviderFailureIndex).toBeGreaterThan(-1);
    expect(whisperProviderSuccessIndex).toBeGreaterThan(whisperProviderFailureIndex);

    const whisperFailureBlock = source.slice(whisperErrorIndex, blockEnd);
    const whisperProviderFailureBlock = source.slice(whisperProviderFailureIndex, whisperProviderSuccessIndex);
    expect(whisperProviderFailureBlock).not.toMatch(/await res\.text\(\)/);
    expect(whisperProviderFailureBlock).not.toMatch(/Whisper failed:/);
    expect(whisperFailureBlock).toMatch(/errorMessage:\s*"Whisper provider request failed\."/);
    expect(whisperFailureBlock).toMatch(/error:\s*"Voice transcription failed\."/);
    expect(whisperFailureBlock).toMatch(/error_code:\s*"TRANSCRIPTION_FAILED"/);
    expect(whisperFailureBlock).not.toMatch(/e instanceof Error \? e\.message/);
    expect(whisperFailureBlock).not.toMatch(/err:\s*String\(e\)/);
  });

  it("routes live compose generation through the shared text provider", () => {
    const missingKeyIndex = source.indexOf("if (!openAiKey && !routerCanUseGemini)");
    const generationIndex = source.indexOf("generation = await generateStructuredText");

    expect(source).toMatch(/generateStructuredText/);
    expect(source).toMatch(/resolveAiTextProviderConfig/);
    expect(source).toMatch(/logComposeProviderAttempts/);
    expect(source).toMatch(/routerCanUseGemini/);
    expect(source).toMatch(/operation:\s*"compose_offer"/);
    expect(source).toMatch(/imageInputs:\s*imageInput \? \[imageInput\] : undefined/);
    expect(missingKeyIndex).toBeGreaterThan(-1);
    expect(generationIndex).toBeGreaterThan(missingKeyIndex);
    expect(source).not.toMatch(/fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/);
    expect(source).not.toMatch(/resolveOpenAiChatModel/);
    expect(source).not.toMatch(/chatCompletionTuning/);
  });

  it("does not log raw text-provider config exceptions", () => {
    const configErrorIndex = source.indexOf('event: "text_provider_config_error"');
    expect(configErrorIndex).toBeGreaterThan(-1);

    const configErrorBlock = source.slice(configErrorIndex - 220, configErrorIndex + 260);
    expect(configErrorBlock).toMatch(/errorCode:\s*"AI_TEXT_CONFIG_INVALID"/);
    expect(configErrorBlock).not.toMatch(/String\(err\)/);
    expect(configErrorBlock).not.toMatch(/err:\s*String/);
  });

  it("does not log raw OpenAI compose provider bodies on live compose failures", () => {
    const providerFailureIndex = source.indexOf("AI_GENERATION_FAILED");
    expect(providerFailureIndex).toBeGreaterThan(-1);

    const liveFailureBlock = source.slice(providerFailureIndex - 1200, providerFailureIndex + 600);
    expect(liveFailureBlock).toMatch(/const attempts = \(err as \{ attempts\?: ProviderAttempt\[\] \}\)\?\.attempts \?\? \[\]/);
    expect(liveFailureBlock).toMatch(/logComposeProviderAttempts/);
    expect(liveFailureBlock).toMatch(/error_code:\s*"AI_GENERATION_FAILED"/);
    expect(liveFailureBlock).not.toMatch(/await openAiRes\.text\(\)/);
    expect(liveFailureBlock).not.toMatch(/errText/);
    expect(liveFailureBlock).not.toMatch(/details:/);
  });

  it("does not log raw unhandled exception text from the outer compose handler", () => {
    const unhandledIndex = source.indexOf('event: "unhandled_error"');
    expect(unhandledIndex).toBeGreaterThan(-1);

    const unhandledBlock = source.slice(unhandledIndex - 300, unhandledIndex + 300);
    expect(unhandledBlock).toMatch(/errorCode:\s*"INTERNAL"/);
    expect(unhandledBlock).not.toMatch(/e instanceof Error \? e\.message/);
    expect(unhandledBlock).not.toMatch(/err:\s*msg/);
    expect(unhandledBlock).not.toMatch(/String\(e\)/);
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
