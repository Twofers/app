import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-deal-suggestions", "index.ts"),
  "utf8",
);

describe("ai-deal-suggestions legacy fallback source guard", () => {
  it("does not return canned insight suggestions when OpenAI is unavailable", () => {
    expect(source).toMatch(/OPENAI_NOT_CONFIGURED/);
    expect(source).toMatch(/status:\s*503/);
    expect(source).not.toMatch(/fallbackSuggestions/);
    expect(source).not.toMatch(/Expand your lineup/);
    expect(source).not.toMatch(/Weekend pastry pairing/);
    expect(source).not.toMatch(/Tell your origin story/);

    const keyMissingIndex = source.indexOf("if (!openAiKey)");
    const modelIndex = source.indexOf("resolveOpenAiChatModel()");
    expect(keyMissingIndex).toBeGreaterThan(-1);
    expect(modelIndex).toBeGreaterThan(keyMissingIndex);
  });
});
