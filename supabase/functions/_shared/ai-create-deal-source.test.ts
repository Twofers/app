import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "supabase", "functions", "ai-create-deal", "index.ts"), "utf8");

describe("ai-create-deal legacy endpoint source guard", () => {
  it("permanently closes the one-shot AI plus live insert path", () => {
    expect(source).toMatch(/AI_CREATE_DEAL_LEGACY_DISABLED/);
    expect(source).toMatch(/status:\s*410/);
    expect(source).not.toMatch(/AI_LEGACY_CREATE_DEAL_ENABLED/);
    expect(source).not.toMatch(/OPENAI_API_KEY/);
    expect(source).not.toMatch(/api\.openai\.com/);
    expect(source).not.toMatch(/chat\/completions/);
    expect(source).not.toMatch(/createClient/);
    expect(source).not.toMatch(/\.from\("deals"\)/);
  });
});
