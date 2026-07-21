import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-extract-menu", "index.ts"),
  "utf8",
);

describe("ai-extract-menu source guards", () => {
  it("keeps synthetic menu samples behind an explicit preview flag", () => {
    expect(source).toMatch(/AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY/);
    expect(source).toMatch(/allowSyntheticWithoutKey/);
    expect(source).toMatch(/extraction_source:\s*"synthetic_fallback"/);
    expect(source).toMatch(/OPENAI_NOT_CONFIGURED/);

    const syntheticIndex = source.indexOf("if (!openAiKey && allowSyntheticWithoutKey)");
    const missingKeyIndex = source.indexOf(
      "if (!openAiKey && !allowSyntheticWithoutKey && !canUseRouterFallbackWithoutOpenAi)",
    );
    const allowanceIndex = source.indexOf(
      'const { data: allowanceConsumed, error: allowanceError } = await admin.rpc',
      missingKeyIndex,
    );
    const providerCallIndex = source.indexOf(
      "const { response: openAiRes } = await fetchOpenAiWithFallback",
      missingKeyIndex,
    );

    expect(syntheticIndex).toBeGreaterThan(-1);
    expect(missingKeyIndex).toBeGreaterThan(-1);
    expect(allowanceIndex).toBeGreaterThan(missingKeyIndex);
    expect(syntheticIndex).toBeGreaterThan(allowanceIndex);
    expect(providerCallIndex).toBeGreaterThan(syntheticIndex);

    const missingKeyBlock = source.slice(missingKeyIndex, allowanceIndex);
    expect(missingKeyBlock).toMatch(/OPENAI_NOT_CONFIGURED/);
    expect(missingKeyBlock).toMatch(/status:\s*503/);
    expect(source).toMatch(/canUseRouterFallbackWithoutOpenAi/);
    expect(source).toMatch(/routerCanUseGemini/);
    expect(missingKeyBlock).not.toMatch(/ok:\s*true/);
    expect(missingKeyBlock).not.toMatch(/synthetic_fallback/);
  });

  it("routes base64 menu images through the shared provider router", () => {
    const routerIndex = source.indexOf("const imageBytes = decodeBase64Image(imageBase64)");
    const providerCallIndex = source.indexOf(
      "const { response: openAiRes } = await fetchOpenAiWithFallback",
      routerIndex,
    );

    expect(routerIndex).toBeGreaterThan(-1);
    expect(providerCallIndex).toBeGreaterThan(routerIndex);

    const routerBlock = source.slice(routerIndex, providerCallIndex);
    expect(routerBlock).toMatch(/generateStructuredText<typeof menuSchema, ExtractionResult>/);
    expect(routerBlock).toMatch(/operation:\s*"merchant_context"/);
    expect(routerBlock).toMatch(/imageInputs:\s*\[\{ bytes: imageBytes, mimeType: imageMime \}\]/);
    expect(routerBlock).toMatch(/promptVersion:\s*MENU_EXTRACTION_PROMPT_VERSION/);
    expect(routerBlock).toMatch(/config:\s*menuExtractionConfig\(\)/);
    expect(routerBlock).toMatch(/logMenuProviderAttempts/);
    // Menu OCR is pinned to Gemini-first (cheap vision) regardless of the copy provider.
    expect(source).toMatch(/function menuExtractionConfig/);
    expect(source).toMatch(/AI_MENU_EXTRACTION_PROVIDER/);
    expect(source).toMatch(/\?\s*"openai"\s*\n?\s*:\s*"gemini"/);
    expect(routerBlock).toMatch(/menuSuccessPayload\(generation\.value, "provider_router"\)/);
    expect(routerBlock).not.toMatch(/api\.openai\.com\/v1\/responses/);
  });

  it("does not log raw OpenAI menu extraction provider bodies on HTTP failures", () => {
    const providerFailureIndex = source.indexOf("if (!openAiRes.ok)");
    const successParseIndex = source.indexOf("const responseJson = await openAiRes.json()", providerFailureIndex);

    expect(providerFailureIndex).toBeGreaterThan(-1);
    expect(successParseIndex).toBeGreaterThan(providerFailureIndex);

    const failureBlock = source.slice(providerFailureIndex, successParseIndex);
    expect(failureBlock).toMatch(/event:\s*"openai_http"/);
    expect(failureBlock).toMatch(/errorMessage:\s*`Menu extraction provider request failed with \${menuErrorCode}\.`/);
    expect(failureBlock).toMatch(/error_code:\s*"OPENAI_ERROR"/);
    expect(failureBlock).not.toMatch(/await openAiRes\.text\(\)/);
    expect(failureBlock).not.toMatch(/errText/);
    expect(failureBlock).not.toMatch(/details:/);
  });

  it("does not log raw exception text from the outer menu extraction handler", () => {
    const outerErrorIndex = source.indexOf('event: "error"');
    expect(outerErrorIndex).toBeGreaterThan(-1);

    const outerErrorBlock = source.slice(outerErrorIndex - 220, outerErrorIndex + 220);
    expect(outerErrorBlock).toMatch(/errorCode:\s*"SERVER_ERROR"/);
    expect(outerErrorBlock).not.toMatch(/err:\s*String\(e\)/);
  });
});
