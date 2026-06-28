import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const doc = readFileSync(join(process.cwd(), "docs", "ai-google-data-flow.md"), "utf8");
const providerSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "ai-text-provider.ts"),
  "utf8",
);

describe("Google/Gemini AI data-flow documentation gate", () => {
  it("documents privacy-sensitive exclusions before text fallback activation", () => {
    expect(doc).toMatch(/AI_TEXT_FALLBACK_ENABLED=false/);
    expect(doc).toMatch(/AI_V3_PROVIDER_ROUTER_ENABLED=true/);
    expect(doc).toMatch(/privacy\/subprocessor update/i);
    expect(doc).toMatch(/Customer personal data is not sent to Google\/Gemini/i);
    expect(doc).toMatch(/QR tokens, claim codes, and redemption codes are not sent/i);
    expect(doc).toMatch(/Voice audio is processed ephemerally/i);
    expect(doc).toMatch(/GEMINI_TEXT_MODEL/);
    expect(doc).toMatch(/GEMINI_JUDGE_MODEL/);
  });

  it("keeps Gemini text fallback closed by default in source", () => {
    expect(providerSource).toMatch(
      /fallbackEnabled:\s*routerEnabled\s*&&\s*envFlag\(env,\s*"AI_TEXT_FALLBACK_ENABLED",\s*false\)/,
    );
    expect(providerSource).toMatch(
      /fallbackProvider:\s*parseProvider\(env\.get\("AI_TEXT_FALLBACK_PROVIDER"\),\s*"gemini"\)/,
    );
  });
});

