import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("ai-generate-ad-variants research source guard", () => {
  it("routes non-web item research through the shared provider router", () => {
    const researchIndex = source.indexOf("async function callResearchModel(");
    const copyStageIndex = source.indexOf("async function generateCopy(");

    expect(researchIndex).toBeGreaterThan(-1);
    expect(copyStageIndex).toBeGreaterThan(researchIndex);

    const researchBlock = source.slice(researchIndex, copyStageIndex);
    const routedIndex = researchBlock.indexOf("if (!isWebSearch)");
    const webSearchFetchIndex = researchBlock.indexOf('fetch("https://api.openai.com/v1/chat/completions"');

    expect(routedIndex).toBeGreaterThan(-1);
    expect(webSearchFetchIndex).toBeGreaterThan(routedIndex);

    const routedBlock = researchBlock.slice(routedIndex, webSearchFetchIndex);
    expect(routedBlock).toMatch(/generateStructuredText<typeof ITEM_RESEARCH_SCHEMA, ItemResearch>/);
    expect(routedBlock).toMatch(/operation:\s*"merchant_context"/);
    expect(routedBlock).toMatch(/promptVersion:\s*ITEM_RESEARCH_PROMPT_VERSION/);
    expect(routedBlock).toMatch(/geminiApiKey/);
    expect(routedBlock).toMatch(/config:\s*resolveAiTextProviderConfig\(\)/);
    expect(routedBlock).toMatch(/logTextProviderAttempts\(costContext, "ad_research", result\.attempts\)/);
    expect(routedBlock).toMatch(/logTextProviderAttempts\(costContext, "ad_research", attempts\)/);
    expect(routedBlock).not.toMatch(/fetch\("https:\/\/api\.openai\.com\/v1\/chat\/completions"/);
  });

  it("keeps live web-search research explicit and separately logged", () => {
    const researchIndex = source.indexOf("async function callResearchModel(");
    const copyStageIndex = source.indexOf("async function generateCopy(");
    const researchBlock = source.slice(researchIndex, copyStageIndex);
    const webSearchFetchIndex = researchBlock.indexOf('fetch("https://api.openai.com/v1/chat/completions"');
    const webSearchBlock = researchBlock.slice(webSearchFetchIndex);

    expect(source).toMatch(/model:\s*RESEARCH_MODEL/);
    expect(webSearchBlock).toMatch(/webSearchCalls:\s*isWebSearch \? 1 : 0/);
    expect(webSearchBlock).toMatch(/endpoint:\s*"chat\.completions"/);
    expect(webSearchBlock).toMatch(/AbortSignal\.timeout\(25_000\)/);
  });
});
