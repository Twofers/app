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

  it("does not return raw OpenAI error details when explicitly re-enabled", () => {
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
