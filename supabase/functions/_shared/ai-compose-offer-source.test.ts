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

  it("does not bias live compose prompts with legacy cafe-specific craft language", () => {
    expect(source).toMatch(/plain, specific local-business language/);
    expect(source).toMatch(/Do not invent freshness/);
    expect(source).toMatch(/Variant A should lead with offer clarity/);
    expect(source).not.toMatch(/craft-focused/);
    expect(source).not.toMatch(/single-origin/);
    expect(source).not.toMatch(/stone-ground/);
    expect(source).not.toMatch(/freshly baked/);
    expect(source).not.toMatch(/owner's best marketer/);
    expect(source).not.toMatch(/craftsperson/);
    expect(source).not.toMatch(/coffee \+ muffin/);
    expect(source).not.toMatch(/latte \+ cookie/);
    expect(source).not.toMatch(/cofee.*mufin/);
    expect(source).not.toMatch(/espreso/);
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

  describe("AI_COMPOSE_REGENERATE_ENABLED: variety regenerate", () => {
    it("defaults off, reading a dedicated env flag", () => {
      expect(source).toMatch(
        /const COMPOSE_REGENERATE_ENABLED = Deno\.env\.get\("AI_COMPOSE_REGENERATE_ENABLED"\) === "true";/,
      );
      expect(source).toMatch(
        /const regenerateRequested = COMPOSE_REGENERATE_ENABLED && body\.regenerate === true;/,
      );
    });

    it("only salts the dedup request_hash when a regenerate was actually requested", () => {
      const hashIndex = source.indexOf("const request_hash = await sha256Hex(");
      expect(hashIndex).toBeGreaterThan(-1);
      const hashBlock = source.slice(hashIndex, hashIndex + 400);
      expect(hashBlock).toMatch(/\.\.\.\(regenerateRequested \? \{ regen: crypto\.randomUUID\(\) \} : \{\}\),/);
      // Salting only touches the hash — cooldown/quota checks below still read
      // their own independent business_id + request_type windows, untouched.
      expect(source).toMatch(/const \{ data: recentCooldown \} = await admin/);
      expect(source).toMatch(/const \{ used \} = await countAiQuotaUsage\(admin, \{/);
    });

    it("only injects the variety-regenerate line into the prompt when regenerate was requested", () => {
      expect(source).toMatch(/let regenerateVarietyLine = "";/);
      expect(source).toMatch(/if \(regenerateRequested\) \{/);
      expect(source).toMatch(
        /Produce meaningfully different framing than these previous suggestions: \$\{previousHeadlines\.join\("; "\)\}/,
      );
      // The prompt array includes the (possibly empty) line unconditionally —
      // .filter(Boolean) below drops it when regenerate wasn't requested, so
      // the built prompt string is byte-identical to before when it's "".
      const userPromptIndex = source.indexOf("const userPrompt = [");
      expect(userPromptIndex).toBeGreaterThan(-1);
      const userPromptBlock = source.slice(userPromptIndex, userPromptIndex + 700);
      expect(userPromptBlock).toMatch(/regenerateVarietyLine,/);
      expect(userPromptBlock).toMatch(/\.filter\(Boolean\)/);
    });

    it("prefers client-supplied previous_headlines before falling back to the stored compose log", () => {
      expect(source).toMatch(/Array\.isArray\(body\.previous_headlines\)/);
      expect(source).toMatch(/await fetchPreviousComposeHeadlines\(admin, business_id\)/);
    });
  });

  describe("AI_COMPOSE_FALLBACK_ENABLED: deterministic compose fallback (F1)", () => {
    it("defaults off, reading a dedicated env flag", () => {
      expect(source).toMatch(
        /const COMPOSE_FALLBACK_ENABLED = Deno\.env\.get\("AI_COMPOSE_FALLBACK_ENABLED"\) === "true";/,
      );
      expect(source).toMatch(/if \(!COMPOSE_FALLBACK_ENABLED\) return null;/);
    });

    it("is attempted at both AI failure surfaces, before either existing 502 path", () => {
      const catchIndex = source.indexOf("} catch (err) {");
      const invalidShapeIndex = source.indexOf('failure_reason: "INVALID_AI_SHAPE"');
      expect(catchIndex).toBeGreaterThan(-1);
      expect(invalidShapeIndex).toBeGreaterThan(-1);

      const firstCallIndex = source.indexOf("await tryComposeFallback(");
      expect(firstCallIndex).toBeGreaterThan(catchIndex);
      expect(firstCallIndex).toBeLessThan(invalidShapeIndex);

      const secondCallIndex = source.indexOf("await tryComposeFallback(", firstCallIndex + 1);
      expect(secondCallIndex).toBeGreaterThan(firstCallIndex);
      expect(secondCallIndex).toBeLessThan(invalidShapeIndex);

      // Exactly the two documented call sites — a third would mean an undocumented
      // new dead-end got fallback coverage without this test being updated for it.
      expect(source.split("await tryComposeFallback(").length - 1).toBe(2);

      // Each call site returns immediately on a non-null fallback response, so the
      // existing failure-log-insert + 502 below it only runs when the fallback
      // itself declined (flag off, unparseable hint, or it failed its own validation).
      expect(source).toMatch(/if \(composeFallbackResponse\) return composeFallbackResponse;/);
    });

    it("never re-logs provider cost for the attempt(s) the caller already logged", () => {
      const fnStart = source.indexOf("async function tryComposeFallback(");
      const fnEnd = source.indexOf("\n    const systemPrompt = [", fnStart);
      expect(fnStart).toBeGreaterThan(-1);
      expect(fnEnd).toBeGreaterThan(fnStart);
      const fnBody = source.slice(fnStart, fnEnd);
      expect(fnBody).not.toMatch(/logComposeProviderAttempts/);
      expect(fnBody).not.toMatch(/logComposeCost/);
    });

    it("salts the logged request_hash so a fallback result can never be replayed by the dedup cache", () => {
      // The dedup-cache lookup earlier in this file selects by the TRUE request_hash;
      // storing the fallback's row under a salted hash guarantees a later retry with
      // identical inputs recomputes that true hash, misses this row, and reaches the
      // real AI call again instead of silently replaying a degraded result.
      expect(source).toMatch(
        /const saltedHash = await sha256Hex\(`\$\{request_hash\}:compose_fallback:\$\{crypto\.randomUUID\(\)\}`\);/,
      );
      expect(source).toMatch(/request_hash: saltedHash,/);
    });

    it("logs the fallback as a real success for quota/cooldown purposes, tagged so it is never mistaken for AI output", () => {
      const fnStart = source.indexOf("async function tryComposeFallback(");
      const fnEnd = source.indexOf("\n    const systemPrompt = [", fnStart);
      const fnBody = source.slice(fnStart, fnEnd);
      expect(fnBody).toMatch(/success:\s*true,/);
      expect(fnBody).toMatch(/failure_reason:\s*null,/);
      expect(fnBody).toMatch(/compose_fallback:\s*true,/);
      expect(fnBody).toMatch(/fallback:\s*true,/);
      expect(fnBody).toMatch(/low_confidence:\s*true,/);
    });
  });
});
