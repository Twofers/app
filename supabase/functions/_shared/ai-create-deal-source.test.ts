import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "supabase", "functions", "ai-create-deal", "index.ts"), "utf8");

describe("ai-create-deal legacy endpoint source guard", () => {
  it("default-closes the one-shot AI plus live insert path before provider or insert work", () => {
    expect(source).toMatch(/AI_LEGACY_CREATE_DEAL_ENABLED/);
    expect(source).toMatch(/AI_CREATE_DEAL_LEGACY_DISABLED/);
    expect(source).toMatch(/status:\s*410/);

    const gateIndex = source.indexOf("isLegacyCreateDealEnabled()");
    const envIndex = source.indexOf('Deno.env.get("SUPABASE_URL")');
    const insertIndex = source.indexOf('.from("deals")');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(envIndex).toBeGreaterThan(gateIndex);
    expect(insertIndex).toBeGreaterThan(gateIndex);
  });

  it("does not retain raw OpenAI error details when explicitly re-enabled", () => {
    const failureIndex = source.indexOf("if (!aiRes.ok)");
    const parseIndex = source.indexOf("const aiJson = await aiRes.json()");

    expect(failureIndex).toBeGreaterThan(-1);
    expect(parseIndex).toBeGreaterThan(failureIndex);

    const openAiErrorBlock = source.slice(failureIndex, parseIndex);
    expect(openAiErrorBlock).toMatch(/const errorCode = `HTTP_\$\{aiRes\.status\}`/);
    expect(openAiErrorBlock).toMatch(/errorCode,\s*[\r\n]+\s*errorMessage:\s*`Legacy create-deal provider request failed with/);
    expect(openAiErrorBlock).toMatch(/AI_GENERATION_FAILED/);
    expect(openAiErrorBlock).toMatch(/status:\s*502/);
    expect(openAiErrorBlock).not.toMatch(/await aiRes\.text\(\)/);
    expect(openAiErrorBlock).not.toMatch(/text\.slice\(0,\s*500\)/);
    expect(openAiErrorBlock).not.toMatch(/details:\s*text/);
  });
});
