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
    const missingKeyIndex = source.indexOf("if (!openAiKey)", syntheticIndex + 1);
    const providerCallIndex = source.indexOf("const openAiRes = await fetch", missingKeyIndex);

    expect(syntheticIndex).toBeGreaterThan(-1);
    expect(missingKeyIndex).toBeGreaterThan(syntheticIndex);
    expect(providerCallIndex).toBeGreaterThan(missingKeyIndex);

    const missingKeyBlock = source.slice(missingKeyIndex, providerCallIndex);
    expect(missingKeyBlock).toMatch(/OPENAI_NOT_CONFIGURED/);
    expect(missingKeyBlock).toMatch(/status:\s*503/);
    expect(missingKeyBlock).not.toMatch(/ok:\s*true/);
    expect(missingKeyBlock).not.toMatch(/synthetic_fallback/);
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
});
