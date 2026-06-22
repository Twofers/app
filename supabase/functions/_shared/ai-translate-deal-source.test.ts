import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-translate-deal", "index.ts"),
  "utf8",
);

describe("ai-translate-deal missing-provider guard", () => {
  it("does not return deterministic translations when OpenAI is unavailable", () => {
    const missingKeyIndex = source.indexOf("if (!openAiKey)");
    const modelIndex = source.indexOf("const chatModel = resolveOpenAiChatModel()");

    expect(missingKeyIndex).toBeGreaterThan(-1);
    expect(modelIndex).toBeGreaterThan(missingKeyIndex);

    const missingKeyBlock = source.slice(missingKeyIndex, modelIndex);
    expect(missingKeyBlock).toMatch(/OPENAI_NOT_CONFIGURED/);
    expect(missingKeyBlock).toMatch(/success:\s*false/);
    expect(missingKeyBlock).toMatch(/openaiCalled:\s*false/);
    expect(missingKeyBlock).toMatch(/503,\s*corsHeaders/);
    expect(missingKeyBlock).not.toMatch(/fallbackResult/);
    expect(missingKeyBlock).not.toMatch(/admin\.from\("deals"\)\.update/);
    expect(missingKeyBlock).not.toMatch(/ok:\s*true/);
  });
});
