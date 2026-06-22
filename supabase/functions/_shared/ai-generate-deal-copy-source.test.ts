import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-deal-copy", "index.ts"),
  "utf8",
);

describe("ai-generate-deal-copy source guards", () => {
  it("does not return raw OpenAI error details to the client", () => {
    const errorTextIndex = source.indexOf("const text = await aiRes.text()");
    const parseIndex = source.indexOf("const aiJson = await aiRes.json()");

    expect(errorTextIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(errorTextIndex);

    const openAiErrorBlock = source.slice(errorTextIndex, parseIndex);
    expect(openAiErrorBlock).toMatch(/errorCode:\s*`HTTP_\$\{aiRes\.status\}`/);
    expect(openAiErrorBlock).toMatch(/errorMessage:\s*text\.slice\(0,\s*500\)/);
    expect(openAiErrorBlock).toMatch(/AI_GENERATION_FAILED/);
    expect(openAiErrorBlock).toMatch(/status:\s*502/);
    expect(openAiErrorBlock).not.toMatch(/details:\s*text/);
  });
});
